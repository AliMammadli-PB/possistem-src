/**
 * Refunding a guest who has already left the building.
 *
 * The refund engine was always complete; what was missing was a way in. This
 * screen is that way in, and these are the properties of it that would rot
 * silently: a lost idempotency key pays the guest twice, a submit button that
 * fires without a reason is rejected by the core with no clue why, and a bridge
 * or gate that forgets the new method makes the whole screen answer nothing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'out/preload/index.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const protocol = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'shared/contracts/protocol.json'), 'utf8'),
);

describe('the refund screen', () => {
  it('is reachable, and only by someone allowed to refund', () => {
    expect(bundle).toContain('function RefundByCodePage()');
    expect(bundle).toContain('path: "/refund"');
    // The route sits inside RequirePermission, so the screen cannot be reached
    // by typing the address.
    const route = bundle.slice(bundle.indexOf('path: "/refund"') - 400,
                               bundle.indexOf('path: "/refund"'));
    expect(route).toContain('permission: "payment.refund"');
    const hubStart=bundle.indexOf('function usePsManagementLinks()');
    expect(hubStart).toBeGreaterThan(-1);
    const hub=bundle.slice(hubStart,bundle.indexOf('const LOGO_RASTER_WIDTH',hubStart));
    expect(hub).toContain('to: "/refund"');
    expect(hub).toContain('show:hasPermission("payment.refund")');
    const sidebar=bundle.slice(bundle.indexOf('  const serviceLinks = ['),bundle.indexOf('  const visible ='));
    expect(sidebar).not.toContain('to: "/refund"');
  });

  it('reaches the core through every layer', () => {
    // Three places have to agree or the call dies silently: the contract, the
    // preload bridge, and main's method gate.
    expect(protocol.methods['receipts.lookupByCode']).toBeTruthy();
    expect(protocol.methods['receipts.lookupByCode'].perm).toBe('payment.refund');
    expect(preload).toContain('call("receipts.lookupByCode", { code })');
    expect(main).toContain('receipts.lookupByCode');
  });

  it('holds one idempotency key for the whole dialog', () => {
    // A refund that reached the core but lost its reply must replay on the next
    // press rather than pay the guest a second time.
    expect(bundle).toContain('const idemRef = reactExports.useRef("")');
    expect(bundle).toContain('window.pos.payments.refund(input, { idempotencyKey: idemRef.current })');
    // And a fresh key after a successful refund, so a second, deliberate refund
    // on the same sale is not swallowed as a replay of the first.
    expect(bundle).toContain('idemRef.current = "refund-" + again.data.receiptId + "-" + Date.now()');
  });

  it('cannot be submitted without the things the core requires', () => {
    expect(bundle).toContain(
      'disabled: busy || !payment || refundMinor <= 0 || !reason.trim()',
    );
    // The cap is checked here too, so the counter is told before the drawer
    // opens rather than by a rejection afterwards.
    expect(bundle).toContain('if (refundMinor > remaining)');
  });

  it('prices a picked line the way the core does', () => {
    // A figure on screen that differs from the figure refunded is how a guest
    // ends up arguing with a cashier who is reading the right number.
    expect(bundle).toContain(
      'const unit = Math.round((item.lineTotalMinor ?? 0) / Math.max(1, item.quantity ?? 1));',
    );
  });

  it('prints the slip, and does not call a failed print a failed refund', () => {
    expect(bundle).toContain('kind: "refund_receipt"');
    expect(bundle).toContain('options: { refundId }');
    expect(bundle).toContain('toast("Qaytarma qəbzi çap olunmadı", "warning")');
  });

  it('re-reads the sale afterwards instead of patching it', () => {
    // A second refund on the same sale has to see what the first one left.
    expect(bundle).toContain('const again = await window.pos.receipts.lookupByCode(found.number)');
  });
});

describe('the drawer screen', () => {
  // Since 1.10.16 cash lives on Kassalar: expenses on Xərclər, money in/out on each account's menu (1.10.25).
  it('offers money in, money out and expenses', () => {
    expect(bundle).toContain('kind:m.kind');
    expect(bundle).toContain('onMoney(account, "cash_in")');
    expect(bundle).toContain('onMoney(account, "cash_out")');
    expect(bundle).toContain('kind: "expense"');
  });

  it('says what money in and money out mean', () => {
    // JSX text is compiled with \u escapes.
    expect(bundle).toContain('Kassaya sat\\u0131\\u015Fdan k\\u0259nar qoyulan pul');
    expect(bundle).toContain('(x\\u0259rc deyil)');
  });
});
