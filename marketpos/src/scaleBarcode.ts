/**
 * Scale label barcodes (1.5.61): the 13 digits a label scale prints and the till reads.
 *
 * The scale decides what its label barcode holds (Dahua TM-A / TM-F: "barcode" programme,
 * 24-character description, Spec001/Spec208/Spec209); the till must read the same layout from
 * `scaleBarcodeRules`. This module turns one layout into those rules, back again, shows a
 * sample, writes the Dahua description to key into the scale, and finds the layout of a label
 * the shop scanned.
 */

export type ScaleMode = 'WEIGHT' | 'PRICE';
export type ScaleRule = { prefix: string; pluStart: number; pluLen: number; valueStart: number; valueLen: number; decimals: number; mode: ScaleMode; checkChecksum: boolean };
export type ScaleLayout = { prefixes: string[]; pluLen: number; valueLen: number; mode: ScaleMode; decimals: number };
export type ScalePreset = { id: string; layout: Omit<ScaleLayout, 'prefixes'>; az: string; ru: string; en: string; dahua: string };
export type ScaleGood = { id: string; name: string; plu?: string; barcode?: string; priceMinor: number; unit: string };

export const ALL_PREFIXES = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];
const PREFIX_LEN = 2;

/** Dahua TM barcode description: four characters per item (source, length, shift, overflow), six items. */
export function dahuaDescription(layout: Omit<ScaleLayout, 'prefixes'>): string {
  const items = [`B${PREFIX_LEN}01`, `E${layout.pluLen}00`, `${layout.mode === 'PRICE' ? 'K' : 'J'}${layout.valueLen}00`];
  while (items.length < 6) items.push('A000');
  return items.join('');
}

const preset = (id: string, pluLen: number, valueLen: number, mode: ScaleMode, az: string, ru: string, en: string): ScalePreset => {
  const layout = { pluLen, valueLen, mode, decimals: mode === 'PRICE' ? 2 : 3 };
  return { id, layout, az, ru, en, dahua: dahuaDescription(layout) };
};

export const SCALE_PRESETS: ScalePreset[] = [
  preset('w5', 5, 5, 'WEIGHT', 'Prefiks + PLU (5) + çəki (5, qram)', 'Префикс + PLU (5) + вес (5, граммы)', 'Prefix + PLU (5) + weight (5, grams)'),
  preset('p5', 5, 5, 'PRICE', 'Prefiks + PLU (5) + məbləğ (5, qəpik) — Dahua zavod barkodu 1', 'Префикс + PLU (5) + сумма (5, копейки) — заводской штрихкод Dahua 1', 'Prefix + PLU (5) + total (5, qəpik) — Dahua factory barcode 1'),
  preset('p6', 4, 6, 'PRICE', 'Prefiks + PLU (4) + məbləğ (6, qəpik) — Dahua zavod barkodu 4', 'Префикс + PLU (4) + сумма (6) — заводской штрихкод Dahua 4', 'Prefix + PLU (4) + total (6) — Dahua factory barcode 4'),
  preset('w6', 4, 6, 'WEIGHT', 'Prefiks + PLU (4) + çəki (6, qram)', 'Префикс + PLU (4) + вес (6, граммы)', 'Prefix + PLU (4) + weight (6, grams)'),
];

/** GS1 mod-10 check digit, as the core checks it. */
export function checkDigit(data: string): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += Number(data[i]) * ((data.length - 1 - i) % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function validLayout(l: ScaleLayout): string {
  if (!l.prefixes.length) return 'prefix';
  if (l.prefixes.some((p) => !/^\d{2}$/.test(p))) return 'prefix';
  if (!(l.pluLen >= 3 && l.pluLen <= 6) || !(l.valueLen >= 4 && l.valueLen <= 6)) return 'length';
  if (PREFIX_LEN + l.pluLen + l.valueLen !== 12) return 'sum';
  if (!(l.decimals >= 0 && l.decimals <= 3)) return 'decimals';
  return '';
}

export function rulesFromLayout(l: ScaleLayout): ScaleRule[] {
  return l.prefixes.map((prefix) => ({ prefix, pluStart: PREFIX_LEN, pluLen: l.pluLen, valueStart: PREFIX_LEN + l.pluLen, valueLen: l.valueLen, decimals: l.decimals, mode: l.mode, checkChecksum: true }));
}

/** The layout behind saved rules; rules the screen cannot show come back as null. */
export function layoutFromRules(rules: unknown): ScaleLayout | null {
  if (!Array.isArray(rules) || !rules.length) return null;
  const first = rules[0] as ScaleRule;
  const same = rules.every((r: ScaleRule) => r && r.pluStart === PREFIX_LEN && String(r.prefix).length === PREFIX_LEN && r.pluLen === first.pluLen && r.valueLen === first.valueLen && r.valueStart === PREFIX_LEN + first.pluLen && r.mode === first.mode && r.decimals === first.decimals);
  if (!same) return null;
  return { prefixes: rules.map((r: ScaleRule) => String(r.prefix)), pluLen: first.pluLen, valueLen: first.valueLen, mode: first.mode === 'PRICE' ? 'PRICE' : 'WEIGHT', decimals: Number(first.decimals) };
}

export function presetOf(l: ScaleLayout): ScalePreset | undefined {
  return SCALE_PRESETS.find((p) => p.layout.pluLen === l.pluLen && p.layout.valueLen === l.valueLen && p.layout.mode === l.mode && p.layout.decimals === l.decimals);
}

/** A sample label barcode for this layout: PLU 12, 0.850 kg or 6.80 AZN. */
export function sampleBarcode(l: ScaleLayout, plu = 12, value?: number): string {
  const v = value ?? (l.mode === 'PRICE' ? 680 : 850);
  const body = (l.prefixes[0] ?? '20') + String(plu).padStart(l.pluLen, '0').slice(-l.pluLen) + String(v).padStart(l.valueLen, '0').slice(-l.valueLen);
  return body + checkDigit(body);
}

export type ScaleReading = { prefix: string; plu: string; raw: number; mode: ScaleMode; kg?: number; totalMinor?: number; checksumOk: boolean };

/** Reads a label the way the core does (13 digits; prefix must be one of the layout's). */
export function readBarcode(code: string, l: ScaleLayout): ScaleReading | null {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 13) return null;
  const prefix = digits.slice(0, PREFIX_LEN);
  if (!l.prefixes.includes(prefix)) return null;
  const plu = digits.slice(PREFIX_LEN, PREFIX_LEN + l.pluLen);
  const raw = Number(digits.slice(PREFIX_LEN + l.pluLen, 12));
  const checksumOk = checkDigit(digits.slice(0, 12)) === Number(digits[12]);
  return l.mode === 'PRICE'
    ? { prefix, plu, raw, mode: l.mode, totalMinor: Math.round(raw * 10 ** (2 - l.decimals)), checksumOk }
    : { prefix, plu, raw, mode: l.mode, kg: raw / 10 ** l.decimals, checksumOk };
}

const pluKey = (plu: string) => String(Number(plu.replace(/\D/g, '')) || '');

/** The good a label points at: by PLU, else a weighed good whose barcode is the label's head. */
export function goodFor(reading: ScaleReading, goods: ScaleGood[], code: string, l: ScaleLayout): ScaleGood | undefined {
  const key = pluKey(reading.plu);
  return goods.find((g) => g.plu && pluKey(g.plu) === key)
    ?? goods.find((g) => /^(kq|kg)$/i.test(g.unit) && g.barcode && g.barcode === code.slice(0, PREFIX_LEN + l.pluLen));
}

export type Candidate = { preset: ScalePreset; reading: ScaleReading; good?: ScaleGood; kg?: number; totalMinor?: number; score: number };

/**
 * Which layout does this scanned label use? Each preset reads the label; a known good, a sane
 * weight and - when the shop typed what the label shows - a matching weight or total rank it.
 */
export function detectLayout(code: string, goods: ScaleGood[], shown?: { kg?: number; totalMinor?: number }): Candidate[] {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 13 || !ALL_PREFIXES.includes(digits.slice(0, 2))) return [];
  const out: Candidate[] = [];
  for (const p of SCALE_PRESETS) {
    const layout: ScaleLayout = { prefixes: [digits.slice(0, 2)], ...p.layout };
    const reading = readBarcode(digits, layout);
    if (!reading) continue;
    const good = goodFor(reading, goods, digits, layout);
    let kg = reading.kg, totalMinor = reading.totalMinor, score = reading.checksumOk ? 1 : -5;
    if (good && good.priceMinor > 0) {
      if (kg !== undefined) totalMinor = Math.round(good.priceMinor * kg);
      else if (totalMinor !== undefined) kg = Math.round((totalMinor / good.priceMinor) * 1000) / 1000;
      score += 4;
    }
    if (kg !== undefined && kg > 0 && kg <= 60) score += 1; else score -= 2;
    if (shown?.kg !== undefined && kg !== undefined) score += Math.abs(kg - shown.kg) <= 0.0015 ? 6 : -4;
    if (shown?.totalMinor !== undefined && totalMinor !== undefined) score += Math.abs(totalMinor - shown.totalMinor) <= 1 ? 6 : -4;
    out.push({ preset: p, reading, good, kg, totalMinor, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
