import { describe, expect, it } from 'vitest';
import { amountInWords, creditLeft, nextInternalBarcode, packPrice, pieceFromPack, priceFor, qtyLabel, splitQty, type Customer } from '../../../topdanpos/src/wholesale';
import { initialProducts } from '../../../topdanpos/src/data';

const water = { packUnits: 6, packName: 'yeşik', unit: 'şüşə', priceMinor: 150, priceWholesaleMinor: 120, priceDealerMinor: 0 };

describe('Topdan POS wholesale rules', () => {
  it('starts with no goods: the warehouse creates its own in stock', () => expect(initialProducts).toHaveLength(0));

  it('prices by the buyer level and falls back to retail when a level is empty', () => {
    expect(priceFor(water, 'retail')).toBe(150);
    expect(priceFor(water, 'wholesale')).toBe(120);
    expect(priceFor(water, 'dealer')).toBe(150);
    expect(priceFor(water, undefined)).toBe(150);
  });

  it('keeps stock in pieces and shows it in packs', () => {
    expect(qtyLabel(water, 20, 'az')).toBe('3 yeşik + 2 şüşə');
    expect(qtyLabel(water, 18, 'az')).toBe('3 yeşik');
    expect(qtyLabel(water, 4, 'az')).toBe('4 şüşə');
    expect(qtyLabel({ packUnits: 1, packName: '', unit: 'kq' }, 7, 'az')).toBe('7 kq');
    expect(splitQty(water, 20)).toEqual({ packs: 3, pieces: 2 });
  });

  it('turns a typed pack price into a piece price and back', () => {
    expect(pieceFromPack(900, 6)).toBe(150);
    expect(packPrice(water, 150)).toBe(900);
    expect(pieceFromPack(1000, 3)).toBe(333);
  });

  it('says the invoice total in Azerbaijani words', () => {
    expect(amountInWords(2400)).toBe('iyirmi dörd manat 00 qəpik');
    expect(amountInWords(12050)).toBe('yüz iyirmi manat 50 qəpik');
    expect(amountInWords(125000099)).toBe('bir milyon iki yüz əlli min manat 99 qəpik');
    expect(amountInWords(100000)).toBe('min manat 00 qəpik');
  });

  it('knows how much credit a customer has left', () => {
    const shop = { creditAllowed: 1, creditLimitMinor: 100000, balanceMinor: 72000 } as Customer;
    expect(creditLeft(shop)).toBe(28000);
    expect(creditLeft({ ...shop, creditAllowed: 0 })).toBe(0);
    expect(creditLeft({ ...shop, balanceMinor: 120000 })).toBe(0);
  });

  it('makes in-store EAN-13 barcodes', () => expect(nextInternalBarcode(new Set(), 42)).toBe('2000000000428'));
});
