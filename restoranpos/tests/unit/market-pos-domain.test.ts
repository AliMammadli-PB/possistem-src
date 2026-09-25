import { describe, expect, it } from 'vitest';
import { cashChange, canAccess, findBarcode, findLoyaltyCustomer, normalizeLoyaltyCard, parseMoneyInput } from '../../../marketpos/src/domain';
import { initialProducts } from '../../../marketpos/src/data';

describe('market POS domain', () => {
  it('calculates cash change in qəpik', () => expect(cashChange(4300, 5000)).toBe(700));
  it('parses AZ decimal cash input', () => expect(parseMoneyInput('50,00')).toBe(5000));
  it('finds exact scanner barcode', () => {
    const sample = initialProducts[5]!;
    expect(findBarcode(initialProducts, sample.barcode)?.id).toBe(sample.id);
  });
  it('returns nothing for a barcode no product carries', () =>
    expect(findBarcode(initialProducts, '0000000000000')).toBeUndefined());
  it('keeps cashier out of manager pages', () => {
    expect(canAccess('cashier', 'sale')).toBe(true);
    expect(canAccess('cashier', 'settings')).toBe(false);
  });
});

describe('loyalty card scanning', () => {
  // A card and a product barcode arrive through the same wedge scanner, so the
  // sale screen has to tell them apart before touching the basket.
  const customers = [
    { id: 'c1', loyaltyCard: '9001234567' },
    { id: 'c2', loyaltyCard: 'BONUS-4477' },
    { id: 'c3' },
  ];

  it('matches a scanned card exactly', () => {
    expect(findLoyaltyCustomer(customers, '9001234567')?.id).toBe('c1');
  });

  it('ignores case, spaces and dashes printed on the card', () => {
    expect(findLoyaltyCustomer(customers, 'bonus4477')?.id).toBe('c2');
    expect(findLoyaltyCustomer(customers, ' BONUS 4477 ')?.id).toBe('c2');
    expect(normalizeLoyaltyCard('BONUS-4477')).toBe('bonus4477');
  });

  it('never matches a customer without a card, or on a partial code', () => {
    expect(findLoyaltyCustomer(customers, '')).toBeUndefined();
    expect(findLoyaltyCustomer(customers, '   ')).toBeUndefined();
    // Partial codes must not fuzzy-match, or a scan would credit a stranger.
    expect(findLoyaltyCustomer(customers, '900123')).toBeUndefined();
    expect(findLoyaltyCustomer(customers, '90012345670')).toBeUndefined();
  });

  it('still resolves an alphanumeric product label', () => {
    const products = [
      { id: 'p1', active: true, barcode: 'ABC123456' },
      { id: 'p2', active: true, barcode: '4769901000001' },
    ] as unknown as Parameters<typeof findBarcode>[0];
    expect(findBarcode(products, 'ABC123456')?.id).toBe('p1');
    expect(findBarcode(products, '4769901000001')?.id).toBe('p2');
  });
});
