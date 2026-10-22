import type { Product } from './types';
import type { LabelUnit } from './labelUnits';
export type LabelBarEdit = { shift: number; top: number; width: number; height: number; hidden: boolean };
export type LabelSample = { name: string; price: string; barcode: string };
export const DEFAULT_LABEL_SAMPLE: LabelSample = { name: '', price: '', barcode: '2001234567893' };
export const LABEL_FONTS = ['Arial','Tahoma','Segoe UI','Verdana','Georgia','Times New Roman','Courier New','sans-serif','serif','monospace'] as const;
export type LabelDesign = { offsetX: number; offsetY: number; margin: number; showName: boolean; nameX: number; nameY: number; nameSize: number; nameLines: number; nameAlign: 'left' | 'center' | 'right'; nameBold: boolean; priceX: number; priceY: number; priceSize: number; priceAlign: 'left' | 'center' | 'right'; priceBold: boolean; barcodeX: number; barcodeY: number; barcodeHeight: number; barWidth: number; digitsX: number; digitsY: number; digitsSize: number; digitsBold: boolean; showDigits: boolean; caption: string; showCaption: boolean; captionX: number; captionY: number; captionSize: number; captionAlign: 'left' | 'center' | 'right'; captionBold: boolean; pricePosition: 'top' | 'bottom'; showBarcode: boolean; nameScaleX: number; nameScaleY: number; priceScaleX: number; priceScaleY: number; digitsScaleX: number; digitsScaleY: number; captionScaleX: number; captionScaleY: number; nameFont: string; priceFont: string; digitsFont: string; captionFont: string; nameItalic: boolean; priceItalic: boolean; digitsItalic: boolean; captionItalic: boolean; inkScale: number; barEdits: Record<string, LabelBarEdit> };
export const DEFAULT_LABEL_DESIGN: LabelDesign = { offsetX: 0, offsetY: 0, margin: 8, showName: true, nameX: 0, nameY: 0, nameSize: 16, nameLines: 2, nameAlign: 'center', nameBold: true, priceX: 0, priceY: 0, priceSize: 22, priceAlign: 'center', priceBold: true, barcodeX: 0, barcodeY: 0, barcodeHeight: 0, barWidth: 0, digitsX: 0, digitsY: 0, digitsSize: 14, digitsBold: false, showDigits: true, caption: '', showCaption: false, captionX: 0, captionY: 0, captionSize: 12, captionAlign: 'center', captionBold: false, pricePosition: 'top', showBarcode: true, nameScaleX: 1, nameScaleY: 1, priceScaleX: 1, priceScaleY: 1, digitsScaleX: 1, digitsScaleY: 1, captionScaleX: 1, captionScaleY: 1, nameFont: 'Arial', priceFont: 'Arial', digitsFont: 'monospace', captionFont: 'Arial', nameItalic: false, priceItalic: false, digitsItalic: false, captionItalic: false, inkScale: 1, barEdits: {} };
export function defaultLabelDesign(dpi = 203): LabelDesign { const d = { ...DEFAULT_LABEL_DESIGN }; if (dpi === 300) for (const k of ['margin', 'nameSize', 'priceSize', 'digitsSize', 'captionSize'] as const) d[k] = Math.round(d[k] * 1.5); return d; }
export type LabelCodeOptions = { barcode?: string; replaceExisting?: boolean; previousBarcode?: string };
export type LabelProfile = { target: string; name: string; model: 'xp350b' | 'generic'; protocol: 'tspl' | 'zpl'; widthMm: number; heightMm: number; gapMm: number; dpi: number; maxWidthMm: number; showPrice: boolean; unit: LabelUnit; design: LabelDesign; sample?: LabelSample };
export type LabelDevice = { target: string; name: string; model: string; connection: string; driver: string; compatible: boolean; protocol: 'tspl' | 'zpl'; preset: 'xp350b' | 'generic'; direct: boolean; selected: boolean };
export type LabelPreview = { image: string; width: number; height: number; barcode: string; nameTruncated: boolean; symbology: string; layers?: Record<string, string>; boxes: Record<string, { x: number; y: number; width: number; height: number }>; stripes?: (import('./labelLayout').LabelBox & { index: number; hidden: boolean })[]; barcodeBase?: import('./labelLayout').LabelBox | null; moduleWidth?: number; warnings?: string[]; outside?: string[]; overlap?: string[] };
export type LabelPrintRequest = { productId: string; profile: LabelProfile; count: number; operationId: string; lang: string; test?: boolean };
export type LabelApi = {
  config(token: string): Promise<LabelProfile>;
  save(token: string, profile: LabelProfile): Promise<LabelProfile>;
  discover(token: string, network?: boolean): Promise<{ printers: LabelDevice[]; profile: LabelProfile }>;
  products(token: string): Promise<Product[]>;
  generate(token: string, id: string, options?: LabelCodeOptions): Promise<Product>;
  preview(token: string, id: string, profile: LabelProfile, lang: string): Promise<LabelPreview>;
  print(token: string, request: LabelPrintRequest): Promise<{ ok: boolean; copies: number; target: string; barcode: string }>;
  driver(token: string, vendor: string): Promise<{ ok: boolean }>;
};
