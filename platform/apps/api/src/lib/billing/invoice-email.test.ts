// Invoice and billing-notice e-mails (1.5.74), against a scripted executor - no database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SQL } from 'drizzle-orm';

process.env.SMTP_HOST ||= 'smtp.fixture.invalid';
const { emailBillingNotices, invoiceHtml, renewalNotice } = await import('./notifications.js');

const sqlText = (s: SQL) => s.queryChunks.map((c) => (typeof c === 'object' && c && 'value' in c ? (c as { value: string[] }).value.join('') : '?')).join('');
function executor(rows: Record<string, unknown[]>) {
  const seen: string[] = [];
  return {
    seen,
    async execute(s: SQL) {
      const text = sqlText(s);
      seen.push(text);
      const key = Object.keys(rows).find((k) => text.includes(k));
      return key ? rows[key] : [];
    },
  };
}

const order = { order_no: 'PS-2026-0042', kind: 'subscription', amount_minor: 5000, paid_at: '2026-10-27T10:00:00Z', delivery_fee_minor: null, product: 'market', period_start: '2026-10-27T10:00:00Z', period_end: '2026-11-27T10:00:00Z' };
const legal = { sellerName: 'POSSISTEM MMC', voen: '1234567890', address: 'Bakı' };

test('a subscription invoice names the number, period, amount and seller', () => {
  const html = invoiceHtml(order, [], 'Sınaq mağazası', legal);
  for (const part of ['PS-2026-0042', 'Market POS — aylıq abunə', '50,00', 'Sınaq mağazası', 'POSSISTEM MMC, VÖEN 1234567890, Bakı', '27.11.2026']) assert.ok(html.includes(part), part);
});

test('a shop invoice lists every item and the delivery fee', () => {
  const html = invoiceHtml({ ...order, kind: 'shop', amount_minor: 13000, product: null, period_start: null, period_end: null, delivery_fee_minor: 500 }, [{ name: 'Barkod skaneri', qty: 2, unit_price_minor: 6250 }], 'Mağaza', legal);
  assert.ok(html.includes('Barkod skaneri × 2'));
  assert.ok(html.includes('Çatdırılma'));
  assert.ok(!html.includes('Dövr'));
});

test('each new notice is mailed once to the owner; an invoice carries the invoice', async () => {
  const db = executor({ 'FROM billing_settings': [{ legal }], 'FROM customers': [{ email: 'owner@fixture.invalid', notify_email: null, name: 'Sınaq mağazası' }], 'FROM billing_orders o': [order], 'FROM billing_order_items': [] });
  const sent: { to: string | string[]; subject: string; html?: string }[] = [];
  const count = await emailBillingNotices(db, [
    { customer_id: '00000000-0000-0000-0000-000000000001', kind: 'billing_invoice', title: 'Invoice PS-2026-0042 — ödəniş qəbul edildi', body: 'Aylıq abunə ödənişi qəbul edildi.', payload: { orderId: '00000000-0000-0000-0000-0000000000aa' } },
    { customer_id: '00000000-0000-0000-0000-000000000001', kind: 'billing_renewal', title: 'Market POS — aylıq ödəniş yaxınlaşır', body: renewalNotice({ enabled: true, paid_until: new Date(Date.now() + 86400000), monthly_amount_minor: 5000, auto_renew: true, product: 'market' })!.body, payload: {} },
  ], async (m) => { sent.push(m); return true; });
  assert.equal(count, 2);
  assert.equal(sent[0]!.to, 'owner@fixture.invalid');
  assert.match(sent[0]!.subject, /Invoice PS-2026-0042/);
  assert.ok(sent[0]!.html!.includes('VÖEN 1234567890'));
  assert.match(sent[1]!.html!, /kartınızdan tutulacaq/);
  assert.equal(await emailBillingNotices(db, [], async () => true), 0);
});

test('a failed send does not stop the rest', async () => {
  const db = executor({ 'FROM billing_settings': [{ legal }], 'FROM customers': [{ email: 'owner@fixture.invalid', notify_email: 'notify@fixture.invalid', name: 'X' }] });
  const to: unknown[] = [];
  const notice = { customer_id: '00000000-0000-0000-0000-000000000001', kind: 'billing_order', title: 'Sifariş', body: 'Ödəniş alınmadı.', payload: {} };
  const count = await emailBillingNotices(db, [notice, notice], async (m) => { to.push(m.to); if (to.length === 1) throw new Error('smtp down'); return true; });
  assert.equal(count, 1);
  assert.deepEqual(to, ['notify@fixture.invalid', 'notify@fixture.invalid']);
});
