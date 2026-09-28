/**
 * What a pharmacy sells and how: dosage forms, shelf groups, storage, packs
 * that may be opened and sold by the unit, prescription medicines, lots with an
 * expiry date, and the GS1 DataMatrix code printed on medicine boxes.
 */
import type { Lang, Product } from './types';

type Labels = Record<Lang, string>;

/** `unit` is what one piece of this form is called when a pack is opened. */
export const DOSAGE_FORMS: Array<{ id: string; icon: string; unit: Labels; labels: Labels }> = [
  { id: 'tablet', icon: 'tablet', unit: { az: 'tablet', ru: 'таб.', en: 'tab' }, labels: { az: 'Tablet', ru: 'Таблетки', en: 'Tablets' } },
  { id: 'capsule', icon: 'capsule', unit: { az: 'kapsul', ru: 'капс.', en: 'caps' }, labels: { az: 'Kapsul', ru: 'Капсулы', en: 'Capsules' } },
  { id: 'syrup', icon: 'bottle', unit: { az: 'flakon', ru: 'фл.', en: 'bottle' }, labels: { az: 'Sirop / məhlul', ru: 'Сироп / раствор', en: 'Syrup / solution' } },
  { id: 'drops', icon: 'drops', unit: { az: 'flakon', ru: 'фл.', en: 'bottle' }, labels: { az: 'Damcı', ru: 'Капли', en: 'Drops' } },
  { id: 'ampoule', icon: 'ampoule', unit: { az: 'ampula', ru: 'амп.', en: 'amp' }, labels: { az: 'Ampula / inyeksiya', ru: 'Ампулы', en: 'Ampoules' } },
  { id: 'powder', icon: 'sachet', unit: { az: 'paket', ru: 'пак.', en: 'sachet' }, labels: { az: 'Toz / paket', ru: 'Порошок', en: 'Powder / sachet' } },
  { id: 'ointment', icon: 'tube', unit: { az: 'tübik', ru: 'туба', en: 'tube' }, labels: { az: 'Məlhəm / krem / gel', ru: 'Мазь / крем', en: 'Ointment / cream' } },
  { id: 'spray', icon: 'spray', unit: { az: 'flakon', ru: 'фл.', en: 'spray' }, labels: { az: 'Sprey / aerozol', ru: 'Спрей', en: 'Spray' } },
  { id: 'inhaler', icon: 'inhaler', unit: { az: 'inhalyator', ru: 'ингал.', en: 'inhaler' }, labels: { az: 'İnhalyator', ru: 'Ингалятор', en: 'Inhaler' } },
  { id: 'suppository', icon: 'suppository', unit: { az: 'şam', ru: 'супп.', en: 'supp' }, labels: { az: 'Şam (supozitori)', ru: 'Суппозитории', en: 'Suppositories' } },
  { id: 'patch', icon: 'patch', unit: { az: 'plastır', ru: 'пласт.', en: 'patch' }, labels: { az: 'Plastır', ru: 'Пластырь', en: 'Patch' } },
  { id: 'device', icon: 'device', unit: { az: 'ədəd', ru: 'шт.', en: 'pc' }, labels: { az: 'Tibbi ləvazimat', ru: 'Медизделие', en: 'Medical device' } },
  { id: 'other', icon: 'box', unit: { az: 'ədəd', ru: 'шт.', en: 'pc' }, labels: { az: 'Digər', ru: 'Другое', en: 'Other' } },
];

export type PharmaCategory = { id: string; order: number; icon: string; labels: Labels };

export const PHARMA_CATEGORIES: PharmaCategory[] = [
  { id: 'Ağrıkəsici', order: 10, icon: 'tablet', labels: { az: 'Ağrıkəsici / qızdırmasalan', ru: 'Обезболивающие', en: 'Pain & fever' } },
  { id: 'Soyuqdəymə', order: 20, icon: 'drops', labels: { az: 'Soyuqdəymə və qrip', ru: 'Простуда и грипп', en: 'Cold & flu' } },
  { id: 'Öskürək', order: 30, icon: 'bottle', labels: { az: 'Öskürək / boğaz', ru: 'Кашель / горло', en: 'Cough & throat' } },
  { id: 'Antibiotik', order: 40, icon: 'capsule', labels: { az: 'Antibiotiklər', ru: 'Антибиотики', en: 'Antibiotics' } },
  { id: 'Ürək-damar', order: 50, icon: 'heart', labels: { az: 'Ürək-damar / təzyiq', ru: 'Сердце и давление', en: 'Heart & blood pressure' } },
  { id: 'Diabet', order: 60, icon: 'device', labels: { az: 'Diabet', ru: 'Диабет', en: 'Diabetes' } },
  { id: 'Mədə-bağırsaq', order: 70, icon: 'sachet', labels: { az: 'Mədə-bağırsaq', ru: 'ЖКТ', en: 'Digestive' } },
  { id: 'Allergiya', order: 80, icon: 'tablet', labels: { az: 'Allergiya', ru: 'Аллергия', en: 'Allergy' } },
  { id: 'Sinir sistemi', order: 90, icon: 'capsule', labels: { az: 'Sinir sistemi / yuxu', ru: 'Нервная система', en: 'Nervous system' } },
  { id: 'Vitamin', order: 100, icon: 'vitamin', labels: { az: 'Vitaminlər / minerallar', ru: 'Витамины', en: 'Vitamins' } },
  { id: 'Dəri', order: 110, icon: 'tube', labels: { az: 'Dəri / məlhəmlər', ru: 'Кожа / мази', en: 'Skin care' } },
  { id: 'Göz-qulaq', order: 120, icon: 'drops', labels: { az: 'Göz / qulaq / burun', ru: 'Глаза / уши / нос', en: 'Eye / ear / nose' } },
  { id: 'Tənəffüs', order: 130, icon: 'inhaler', labels: { az: 'Tənəffüs / astma', ru: 'Дыхание / астма', en: 'Respiratory' } },
  { id: 'Hormon', order: 140, icon: 'tablet', labels: { az: 'Hormonal preparatlar', ru: 'Гормоны', en: 'Hormones' } },
  { id: 'Qadın sağlamlığı', order: 150, icon: 'heart', labels: { az: 'Qadın sağlamlığı', ru: 'Женское здоровье', en: "Women's health" } },
  { id: 'Uşaq', order: 160, icon: 'baby', labels: { az: 'Uşaq preparatları', ru: 'Детские', en: 'Children' } },
  { id: 'Ana və körpə', order: 170, icon: 'baby', labels: { az: 'Ana və körpə', ru: 'Мама и малыш', en: 'Mother & baby' } },
  { id: 'Antiseptik', order: 180, icon: 'bottle', labels: { az: 'Antiseptik / dezinfeksiya', ru: 'Антисептики', en: 'Antiseptics' } },
  { id: 'Sarğı', order: 190, icon: 'patch', labels: { az: 'Sarğı / plastır', ru: 'Перевязка', en: 'Dressings' } },
  { id: 'Tibbi cihaz', order: 200, icon: 'device', labels: { az: 'Tibbi cihazlar', ru: 'Медтехника', en: 'Medical devices' } },
  { id: 'Ortopediya', order: 210, icon: 'device', labels: { az: 'Ortopediya', ru: 'Ортопедия', en: 'Orthopaedics' } },
  { id: 'Gigiyena', order: 220, icon: 'drops', labels: { az: 'Gigiyena', ru: 'Гигиена', en: 'Hygiene' } },
  { id: 'Kosmetika', order: 230, icon: 'tube', labels: { az: 'Aptek kosmetikası', ru: 'Аптечная косметика', en: 'Pharmacy cosmetics' } },
  { id: 'Fitopreparat', order: 240, icon: 'leaf', labels: { az: 'Bitki mənşəli / çay', ru: 'Фитопрепараты', en: 'Herbal' } },
  { id: 'İdman qidası', order: 250, icon: 'vitamin', labels: { az: 'Qida əlavələri', ru: 'БАДы', en: 'Supplements' } },
  { id: 'Digər', order: 900, icon: 'box', labels: { az: 'Digər', ru: 'Другое', en: 'Other' } },
];

export const STORAGE: Array<{ id: string; labels: Labels }> = [
  { id: 'room', labels: { az: 'Otaq temperaturu (15-25 °C)', ru: 'Комнатная (15-25 °C)', en: 'Room (15-25 °C)' } },
  { id: 'cool', labels: { az: 'Soyuducu (2-8 °C)', ru: 'Холодильник (2-8 °C)', en: 'Fridge (2-8 °C)' } },
  { id: 'frozen', labels: { az: 'Dondurulmuş (-18 °C)', ru: 'Заморозка (-18 °C)', en: 'Frozen (-18 °C)' } },
  { id: 'dark', labels: { az: 'Qaranlıq, quru yer', ru: 'Тёмное сухое место', en: 'Dark and dry' } },
];

const formById = new Map(DOSAGE_FORMS.map((row) => [row.id, row]));
const categoryById = new Map(PHARMA_CATEGORIES.map((row) => [row.id, row]));

export const formInfo = (id: string | undefined) => formById.get(id ?? '') ?? formById.get('other')!;
export const categoryInfo = (id: string) => categoryById.get(id) ?? categoryById.get('Digər')!;
export const storageLabel = (id: string | undefined, lang: Lang) => STORAGE.find((row) => row.id === id)?.labels[lang] ?? '';

/** Units in one pack; 1 for a product that is not opened. */
export const packUnitsOf = (product: Pick<Product, 'packUnits' | 'splitAllowed'>) =>
  product.splitAllowed ? Math.max(1, Math.floor(product.packUnits ?? 1)) : 1;

/** A split product keeps stock and price per unit; the pack price is the unit price × units. */
export const packPriceOf = (product: Pick<Product, 'priceMinor' | 'packUnits' | 'splitAllowed'>) => product.priceMinor * packUnitsOf(product);

/** "2 qutu + 5 tablet", or "3 qutu" for a product sold whole. */
export function qtyLabel(product: Pick<Product, 'packUnits' | 'splitAllowed' | 'dosageForm'>, units: number, lang: Lang): string {
  const per = packUnitsOf(product);
  const box = lang === 'ru' ? 'уп.' : lang === 'en' ? 'pack' : 'qutu';
  if (per === 1) return `${units} ${box}`;
  const packs = Math.floor(units / per);
  const rest = units % per;
  const unit = formInfo(product.dosageForm).unit[lang];
  return [packs ? `${packs} ${box}` : '', rest ? `${rest} ${unit}` : ''].filter(Boolean).join(' + ') || `0 ${unit}`;
}

/** Unit price from a pack price, rounded to the qəpik. */
export const unitPriceFromPack = (packPriceMinor: number, units: number) => Math.round(packPriceMinor / Math.max(1, units));

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'none';
export const EXPIRY_WARN_DAYS = 90;

export function expiryState(expiresAt: number | null | undefined, now = Date.now()): ExpiryState {
  if (!expiresAt) return 'none';
  if (expiresAt < now) return 'expired';
  return expiresAt - now <= EXPIRY_WARN_DAYS * 86_400_000 ? 'soon' : 'ok';
}

export type Lot = { id: string; product_id: string; lot_number: string; expires_at: number | null; qty_remaining: number; supplier?: string };

/** The lot a sale takes next: the earliest expiry among lots still in date (FEFO). */
export function nextLot(lots: Lot[], now = Date.now()): Lot | undefined {
  return lots
    .filter((lot) => lot.qty_remaining > 0 && (!lot.expires_at || lot.expires_at >= now))
    .sort((a, b) => (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity))[0];
}

/**
 * GS1 DataMatrix on a medicine box: (01) GTIN-14, (17) expiry YYMMDD,
 * (10) lot, (21) serial. Scanners send it with FNC1 as the GS character
 * (\u001d) or, typed by hand, in brackets. Returns null for a plain barcode.
 */
export function parseGs1(raw: string): { gtin: string; ean13?: string; expiry?: number; lot?: string; serial?: string } | null {
  const text = raw.trim().replace(/^\]d2|^\]C1/, '');
  const fields: Record<string, string> = {};
  if (text.startsWith('(')) {
    for (const match of text.matchAll(/\((\d{2})\)([^(]*)/g)) fields[match[1]!] = match[2]!.trim();
  } else {
    const fixed: Record<string, number> = { '01': 14, '17': 6, '11': 6, '15': 6 };
    let rest = text.replace(/\u001d+$/, '');
    while (rest.length >= 2) {
      const ai = rest.slice(0, 2);
      rest = rest.slice(2);
      if (fixed[ai]) {
        fields[ai] = rest.slice(0, fixed[ai]);
        rest = rest.slice(fixed[ai]);
      } else if (ai === '10' || ai === '21') {
        const end = rest.indexOf('\u001d');
        fields[ai] = end < 0 ? rest : rest.slice(0, end);
        rest = end < 0 ? '' : rest.slice(end + 1);
      } else return Object.keys(fields).length ? toResult(fields) : null;
      if (rest.startsWith('\u001d')) rest = rest.slice(1);
    }
  }
  return fields['01'] && /^\d{14}$/.test(fields['01']) ? toResult(fields) : null;
}

function toResult(fields: Record<string, string>) {
  const gtin = fields['01'] ?? '';
  const exp = fields['17'];
  let expiry: number | undefined;
  if (exp && /^\d{6}$/.test(exp)) {
    const year = 2000 + Number(exp.slice(0, 2));
    const month = Number(exp.slice(2, 4));
    // Day 00 means "end of the month".
    const day = Number(exp.slice(4, 6)) || new Date(year, month, 0).getDate();
    expiry = new Date(year, month - 1, day, 23, 59, 59).getTime();
  }
  return { gtin, ean13: gtin.startsWith('0') ? gtin.slice(1) : undefined, expiry, lot: fields['10'], serial: fields['21'] };
}
