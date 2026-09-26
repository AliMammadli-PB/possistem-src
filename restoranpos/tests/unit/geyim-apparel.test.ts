import { describe, expect, it } from 'vitest';
import { buildVariants, ean13CheckDigit, groupModels, nextInternalBarcode, sortSizes } from '../../../geyimpos/src/apparel';
import { code128Modules, code128Symbols } from '../../../geyimpos/src/code128';
import { initialProducts } from '../../../geyimpos/src/data';
import { findBarcode } from '../../../geyimpos/src/domain';
import type { Product } from '../../../geyimpos/src/types';

const model = {
  name: { az: 'Köynək', ru: 'Köynək', en: 'Köynək' }, category: 'Köynək', unit: 'əd', priceMinor: 4990, costMinor: 2100,
  minStock: 1, taxRate: 18, supplier: '', image: { kind: 'url' as const, url: '' }, active: true, createdAt: 1, accent: '#000',
};

describe('Geyim POS catalogue', () => {
  it('starts with no products: the shop creates its own in stock', () => expect(initialProducts).toHaveLength(0));

  it('computes EAN-13 check digits', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(ean13CheckDigit('476000000000')).toBe(9);
  });

  it('issues unique in-store EAN-13s from the 20 prefix', () => {
    const taken = new Set<string>();
    const a = nextInternalBarcode(taken, 7);
    const b = nextInternalBarcode(taken, 7);
    expect(a).toMatch(/^20\d{11}$/);
    expect(b).not.toBe(a);
    expect(Number(a.at(-1))).toBe(ean13CheckDigit(a.slice(0, 12)));
  });

  it('builds one variant per size and colour under one model', () => {
    let n = 0;
    const { parentId, variants } = buildVariants(model, 'KN-100', [
      { color: 'Qara', size: 'S', qty: 2 }, { color: 'Qara', size: 'M', qty: 0 }, { color: 'Qara', size: 'L', qty: 1 },
      { color: 'Ağ', size: 'S', qty: 1 }, { color: 'Ağ', size: 'M', qty: 3 }, { color: 'Ağ', size: 'L', qty: 0 },
    ], new Set(), () => `id-${n++}`);
    expect(variants).toHaveLength(6);
    expect(new Set(variants.map((v) => v.sku)).size).toBe(6);
    expect(new Set(variants.map((v) => v.barcode)).size).toBe(6);
    expect(variants.every((v) => v.parentProductId === parentId)).toBe(true);
    expect(variants[0]).toMatchObject({ sku: 'KN100-QARA-S', color: 'Qara', size: 'S', stock: 2 });
    const groups = groupModels(variants as Product[]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.variants).toHaveLength(6);
    expect(findBarcode(variants as Product[], variants[4]!.barcode)?.size).toBe('M');
  });

  it('orders sizes by their scale', () => expect(sortSizes(['XL', 'S', 'M', '3XL'])).toEqual(['S', 'M', 'XL', '3XL']));
});

describe('CODE128', () => {
  it('uses code set C for digit runs and set B for the rest', () => {
    // 2000000000015: start C, six digit pairs, switch to B, "5", checksum.
    const symbols = code128Symbols('2000000000015');
    expect(symbols.slice(0, 8)).toEqual([105, 20, 0, 0, 0, 0, 1, 100]);
    expect(symbols[8]).toBe('5'.charCodeAt(0) - 32);
    expect(code128Symbols('KN100-BL-M')[0]).toBe(104);
  });

  it('checksums with position weights, mod 103', () => {
    const symbols = code128Symbols('PJJ123C');
    const body = symbols.slice(0, -1);
    expect(symbols.at(-1)).toBe(body.reduce((sum, v, i) => sum + v * Math.max(1, i), 0) % 103);
  });

  it('has a valid pattern for every set-B character and set-C pair (bars even, 11 modules)', () => {
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    const pairs = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0')).join('');
    for (const modules of [code128Modules(ascii), code128Modules(pairs)]) for (let i = 0; i + 6 < modules.length; i += 6) {
      const symbol = modules.slice(i, i + 6);
      expect(symbol.reduce((a, b) => a + b, 0)).toBe(11);
      expect((symbol[0]! + symbol[2]! + symbol[4]!) % 2).toBe(0);
    }
  });

  it('draws 11 modules per symbol and 13 for stop', () => {
    const text = 'AB-12';
    expect(code128Modules(text).reduce((a, b) => a + b, 0)).toBe(11 * code128Symbols(text).length + 13);
  });
});
