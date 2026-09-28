import { describe, expect, it } from 'vitest';
import { expiryState, nextLot, packPriceOf, parseGs1, qtyLabel, unitPriceFromPack, type Lot } from '../../../aptekpos/src/pharmacy';
import { initialProducts } from '../../../aptekpos/src/data';

const para = { packUnits: 20, splitAllowed: true, dosageForm: 'tablet', priceMinor: 15 };

describe('Aptek POS pharmacy rules', () => {
  it('starts with no products: the pharmacy creates its own in stock', () => expect(initialProducts).toHaveLength(0));

  it('reads GS1 DataMatrix with FNC1 separators', () => {
    const scan = parseGs1('0104601234567893172612311012AB34\u001d21SER001');
    expect(scan).toMatchObject({ gtin: '04601234567893', ean13: '4601234567893', lot: '12AB34', serial: 'SER001' });
    expect(new Date(scan!.expiry!).toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('reads GS1 in bracket form, day 00 meaning the end of the month', () => {
    const scan = parseGs1('(01)04601234567893(17)270200(10)L7');
    expect(scan?.lot).toBe('L7');
    expect(new Date(scan!.expiry!).getDate()).toBe(28);
  });

  it('leaves a plain EAN-13 to the normal barcode lookup', () => expect(parseGs1('4601234567893')).toBeNull());

  it('shows an opened pack as packs plus units', () => {
    expect(qtyLabel(para, 45, 'az')).toBe('2 qutu + 5 tablet');
    expect(qtyLabel({ ...para, splitAllowed: false }, 3, 'az')).toBe('3 qutu');
    expect(packPriceOf(para)).toBe(300);
    expect(unitPriceFromPack(500, 3)).toBe(167);
  });

  it('flags expired and soon-to-expire lots', () => {
    const now = Date.UTC(2026, 8, 1);
    expect(expiryState(now - 1, now)).toBe('expired');
    expect(expiryState(now + 30 * 86_400_000, now)).toBe('soon');
    expect(expiryState(now + 400 * 86_400_000, now)).toBe('ok');
    expect(expiryState(null, now)).toBe('none');
  });

  it('takes the earliest in-date lot first (FEFO)', () => {
    const now = Date.UTC(2026, 8, 1);
    const lots: Lot[] = [
      { id: 'a', product_id: 'p', lot_number: 'LATE', expires_at: now + 400 * 86_400_000, qty_remaining: 5 },
      { id: 'b', product_id: 'p', lot_number: 'OLD', expires_at: now - 86_400_000, qty_remaining: 5 },
      { id: 'c', product_id: 'p', lot_number: 'SOON', expires_at: now + 40 * 86_400_000, qty_remaining: 5 },
      { id: 'd', product_id: 'p', lot_number: 'EMPTY', expires_at: now + 10 * 86_400_000, qty_remaining: 0 },
    ];
    expect(nextLot(lots, now)?.lot_number).toBe('SOON');
  });
});
