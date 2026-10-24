import { describe, expect, it } from 'vitest';
import { DEFAULT_LABEL_DESIGN } from '../../../marketpos/src/labelTypes';
import { clampOffset, freezeBarcode, holdInPlace, scaledSize, snapCenter } from '../../../marketpos/src/labelLayout';

const box = (y: number, height = 20) => ({ x: 10, y, width: 100, height });

describe('market label visual editing', () => {
  it('keeps untouched parts where they were when a part above grows', () => {
    const design = { ...DEFAULT_LABEL_DESIGN, priceY: 5 };
    const before = { name: box(8), price: box(31), barcode: box(60, 80), digits: box(143) };
    const after = { name: box(8, 40), price: box(51), barcode: box(80, 80), digits: box(163) };
    expect(holdInPlace(design, before, after, ['name'])).toEqual({ priceY: -15, barcodeY: -20, digitsY: -20 });
  });
  it('lets linked digits follow the barcode bottom but holds them for a top-edge drag', () => {
    const before = { barcode: box(60, 80), digits: box(143) };
    expect(holdInPlace(DEFAULT_LABEL_DESIGN, before, { barcode: box(60, 100), digits: box(163) }, ['barcode'], true)).toEqual({});
    expect(holdInPlace(DEFAULT_LABEL_DESIGN, before, { barcode: box(40, 100), digits: box(163) }, ['barcode'], true)).toEqual({ digitsY: -20 });
    expect(holdInPlace(DEFAULT_LABEL_DESIGN, before, { barcode: box(60, 100), digits: box(163) }, ['barcode'], false)).toEqual({ digitsY: -20 });
  });
  it('ignores parts that were hidden or shown', () => {
    expect(holdInPlace(DEFAULT_LABEL_DESIGN, { name: box(8), price: box(31) }, { price: box(8) }, ['name'])).toEqual({ priceY: 23 });
  });
  it('freezes an automatic barcode height at what was drawn', () => {
    expect(freezeBarcode(DEFAULT_LABEL_DESIGN, { barcode: box(60, 77) })).toEqual({ barcodeHeight: 77 });
    expect(freezeBarcode({ ...DEFAULT_LABEL_DESIGN, barcodeHeight: 50 }, { barcode: box(60, 77) })).toEqual({});
  });
  it('scales fonts, snaps to centre and preserves unrestricted fractional offsets', () => {
    expect(scaledSize(16, 20, 40)).toBe(32);
    expect(scaledSize(16, 20, 1)).toBe(6);
    expect(scaledSize(200, 20, 100)).toBe(400);
    expect(snapCenter(148, 100, 400, 4)).toEqual({ x: 150, snapped: true });
    expect(snapCenter(140, 100, 400, 4)).toEqual({ x: 140, snapped: false });
    expect(clampOffset(5000)).toBe(5000);
    expect(clampOffset(-3000.4)).toBe(-3000.4);
  });
});
