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
    expect(bundle).toContain('label: "Geri qaytarma", icon: ReceiptText, show: hasPermission("payment.refund")');
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
  it('offers every movement kind the core accepts', () => {
    // The schema has allowed four since it landed and the screen offered two,
    // so money paid to a supplier looked identical to a shortfall.
    for (const kind of ['cash_in', 'cash_out', 'expense', 'float_adjust']) {
      expect(bundle).toContain(`setKind("${kind}")`);
    }
  });

  it('says what each kind means', () => {
    expect(bundle).toContain('Xərc: kassadan ödəniş edilib');
  });
});
