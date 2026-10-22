import type { LabelDesign } from './labelTypes';

/**
 * Photoshop-style editing on top of a top-to-bottom label layout: the parts of
 * a label sit under one another, so a part that grows, shrinks or is hidden
 * would push the parts below it. These helpers keep every untouched part where
 * the operator left it.
 */
export type LabelElement = 'name' | 'price' | 'barcode' | 'digits' | 'caption';
export type LabelBox = { x: number; y: number; width: number; height: number };
export const LABEL_ELEMENTS: LabelElement[] = ['name', 'price', 'barcode', 'digits', 'caption'];

/**
 * Moves each untouched part back to where it was before the edit (measured
 * from two renders). With `linked`, the digits keep their distance to the
 * barcode's bottom edge instead, so they follow a taller or shorter barcode.
 */
export function holdInPlace(design: LabelDesign, before: Record<string, LabelBox>, after: Record<string, LabelBox>, edited: readonly LabelElement[], linked = false): Partial<LabelDesign> {
  const patch: Partial<LabelDesign> = {};
  const bottom = (b: LabelBox) => b.y + b.height;
  for (const key of LABEL_ELEMENTS) {
    if (edited.includes(key) || !before[key] || !after[key]) continue;
    const follow = key === 'digits' && linked && edited.includes('barcode') && before.barcode && after.barcode ? bottom(after.barcode) - bottom(before.barcode) : 0;
    const dy = after[key]!.y - before[key]!.y - follow;
    if (dy) (patch as Record<string, number>)[`${key}Y`] = clampOffset(design[`${key}Y`] - dy);
  }
  return patch;
}

/** Paper edges never clamp a design position. The engine validates finite coordinates. */
export const clampOffset = (n: number) => Math.round(n * 10000) / 10000;

/** An automatic barcode height follows the free room; editing freezes it at what is drawn. */
export function freezeBarcode(design: LabelDesign, boxes: Record<string, LabelBox>): Partial<LabelDesign> {
  return design.barcodeHeight === 0 && boxes.barcode ? { barcodeHeight: boxes.barcode.height } : {};
}

/** A text part's font size for a box dragged from `from` to `to` dots tall. */
export function scaledSize(size: number, from: number, to: number) {
  return Math.min(400, Math.max(6, Math.round(size * Math.max(1, to) / Math.max(1, from))));
}

/** Snap a dragged part's centre to the label's vertical centre line within `tolerance` dots. */
export function snapCenter(x: number, width: number, labelWidth: number, tolerance: number) {
  const offset = labelWidth / 2 - (x + width / 2);
  return Math.abs(offset) <= tolerance ? { x: x + offset, snapped: true } : { x, snapped: false };
}
