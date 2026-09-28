/**
 * Topdan POS (wholesale) reference data and rules.
 *
 * Stock is always kept in pieces. A product ships in a pack (yeşik, blok,
 * qutu…) of `packUnits` pieces; prices are stored per piece, typed and shown
 * per pack. Every product has three price levels, and the customer's level
 * (set on the customer) decides which one the till charges — the core
 * enforces the same rule (sale.complete reads customers.price_tier).
 */
import {
  Apple, Baby, Beef, Boxes, Candy, Coffee, Container, Cookie, CupSoda, Droplets, Egg, Hammer, Milk,
  Package, Paintbrush, Scale, ScrollText, Snowflake, Soup, Sparkles, SprayCan, Wheat, Wine,
  type LucideIcon,
} from 'lucide-react';

import type { Lang, Product } from './types';

type Labels = Record<Lang, string>;

export const PIECE_UNITS: Array<{ id: string; labels: Labels }> = [
  { id: 'ədəd', labels: { az: 'ədəd', ru: 'шт.', en: 'pc' } },
  { id: 'kq', labels: { az: 'kq', ru: 'кг', en: 'kg' } },
  { id: 'litr', labels: { az: 'litr', ru: 'л', en: 'L' } },
  { id: 'metr', labels: { az: 'metr', ru: 'м', en: 'm' } },
  { id: 'paket', labels: { az: 'paket', ru: 'пакет', en: 'bag' } },
  { id: 'şüşə', labels: { az: 'şüşə', ru: 'бут.', en: 'bottle' } },
  { id: 'banka', labels: { az: 'banka', ru: 'банка', en: 'can' } },
];

export const PACK_NAMES: Array<{ id: string; labels: Labels }> = [
  { id: 'yeşik', labels: { az: 'yeşik', ru: 'ящик', en: 'case' } },
  { id: 'qutu', labels: { az: 'qutu', ru: 'коробка', en: 'box' } },
  { id: 'blok', labels: { az: 'blok', ru: 'блок', en: 'block' } },
  { id: 'kisə', labels: { az: 'kisə', ru: 'мешок', en: 'sack' } },
  { id: 'paket', labels: { az: 'paket', ru: 'упаковка', en: 'pack' } },
  { id: 'rulon', labels: { az: 'rulon', ru: 'рулон', en: 'roll' } },
  { id: 'palet', labels: { az: 'palet', ru: 'паллет', en: 'pallet' } },
];

export const CATEGORIES: Array<{ id: string; order: number; icon: LucideIcon; labels: Labels }> = [
  { id: 'Un və taxıl', order: 10, icon: Wheat, labels: { az: 'Un və taxıl', ru: 'Мука и крупы', en: 'Flour & grains' } },
  { id: 'Şəkər və duz', order: 20, icon: Scale, labels: { az: 'Şəkər və duz', ru: 'Сахар и соль', en: 'Sugar & salt' } },
  { id: 'Yağlar', order: 30, icon: Droplets, labels: { az: 'Yağlar', ru: 'Масла', en: 'Oils' } },
  { id: 'Makaron', order: 40, icon: Soup, labels: { az: 'Makaron və düyü', ru: 'Макароны и рис', en: 'Pasta & rice' } },
  { id: 'Konserv', order: 50, icon: Container, labels: { az: 'Konserv', ru: 'Консервы', en: 'Canned food' } },
  { id: 'Çay və qəhvə', order: 60, icon: Coffee, labels: { az: 'Çay və qəhvə', ru: 'Чай и кофе', en: 'Tea & coffee' } },
  { id: 'Şirniyyat', order: 70, icon: Candy, labels: { az: 'Şirniyyat', ru: 'Сладости', en: 'Sweets' } },
  { id: 'Peçenye', order: 80, icon: Cookie, labels: { az: 'Peçenye və çörək', ru: 'Печенье и хлеб', en: 'Biscuits & bread' } },
  { id: 'İçkilər', order: 90, icon: CupSoda, labels: { az: 'İçkilər', ru: 'Напитки', en: 'Drinks' } },
  { id: 'Su', order: 100, icon: Droplets, labels: { az: 'Su', ru: 'Вода', en: 'Water' } },
  { id: 'Spirtli içkilər', order: 110, icon: Wine, labels: { az: 'Spirtli içkilər', ru: 'Алкоголь', en: 'Alcohol' } },
  { id: 'Süd məhsulları', order: 120, icon: Milk, labels: { az: 'Süd məhsulları', ru: 'Молочные', en: 'Dairy' } },
  { id: 'Yumurta', order: 130, icon: Egg, labels: { az: 'Yumurta', ru: 'Яйца', en: 'Eggs' } },
  { id: 'Ət və balıq', order: 140, icon: Beef, labels: { az: 'Ət və balıq', ru: 'Мясо и рыба', en: 'Meat & fish' } },
  { id: 'Dondurulmuş', order: 150, icon: Snowflake, labels: { az: 'Dondurulmuş', ru: 'Заморозка', en: 'Frozen' } },
  { id: 'Meyvə-tərəvəz', order: 160, icon: Apple, labels: { az: 'Meyvə-tərəvəz', ru: 'Фрукты и овощи', en: 'Fruit & veg' } },
  { id: 'Məişət kimyası', order: 170, icon: SprayCan, labels: { az: 'Məişət kimyası', ru: 'Бытовая химия', en: 'Household' } },
  { id: 'Gigiyena', order: 180, icon: Sparkles, labels: { az: 'Gigiyena', ru: 'Гигиена', en: 'Hygiene' } },
  { id: 'Uşaq', order: 190, icon: Baby, labels: { az: 'Uşaq məhsulları', ru: 'Детское', en: 'Baby' } },
  { id: 'Kağız məhsulları', order: 200, icon: ScrollText, labels: { az: 'Kağız məhsulları', ru: 'Бумажные', en: 'Paper goods' } },
  { id: 'Qablaşdırma', order: 210, icon: Package, labels: { az: 'Qablaşdırma', ru: 'Упаковка', en: 'Packaging' } },
  { id: 'Tikinti', order: 220, icon: Hammer, labels: { az: 'Tikinti və təsərrüfat', ru: 'Стройка и хозтовары', en: 'Building & hardware' } },
  { id: 'Boya', order: 230, icon: Paintbrush, labels: { az: 'Boya və alət', ru: 'Краски и инструмент', en: 'Paint & tools' } },
  { id: 'Digər', order: 900, icon: Boxes, labels: { az: 'Digər', ru: 'Другое', en: 'Other' } },
];

export const categoryInfo = (id: string) => CATEGORIES.find((row) => row.id === id) ?? CATEGORIES[CATEGORIES.length - 1]!;

export type PriceTier = 'retail' | 'wholesale' | 'dealer';
export const PRICE_TIERS: Array<{ id: PriceTier; labels: Labels; hint: Labels }> = [
  { id: 'retail', labels: { az: 'Pərakəndə', ru: 'Розница', en: 'Retail' }, hint: { az: 'Adi alıcı', ru: 'Обычный покупатель', en: 'Walk-in buyer' } },
  { id: 'wholesale', labels: { az: 'Topdan', ru: 'Опт', en: 'Wholesale' }, hint: { az: 'Mağaza, market', ru: 'Магазин', en: 'Shops' } },
  { id: 'dealer', labels: { az: 'Diler', ru: 'Дилер', en: 'Dealer' }, hint: { az: 'Region diler, böyük alıcı', ru: 'Дилер', en: 'Dealers, big buyers' } },
];
export const tierLabel = (tier: string | undefined, lang: Lang) => (PRICE_TIERS.find((row) => row.id === tier) ?? PRICE_TIERS[0]!).labels[lang];

/** Pieces in one pack (1 when the product is sold only by the piece). */
export const packUnitsOf = (product: Pick<Product, 'packUnits'>) => Math.max(1, Math.floor(product.packUnits ?? 1));
export const unitLabel = (product: Pick<Product, 'unit'>, lang: Lang) => (PIECE_UNITS.find((row) => row.id === product.unit)?.labels[lang]) ?? product.unit ?? 'ədəd';
export const packLabel = (product: Pick<Product, 'packName'>, lang: Lang) => (PACK_NAMES.find((row) => row.id === product.packName)?.labels[lang]) ?? product.packName ?? '';

/** The piece price for a customer's level; a level left at 0 falls back to retail. */
export function priceFor(product: Pick<Product, 'priceMinor' | 'priceWholesaleMinor' | 'priceDealerMinor'>, tier: PriceTier | string | undefined): number {
  if (tier === 'wholesale' && (product.priceWholesaleMinor ?? 0) > 0) return product.priceWholesaleMinor!;
  if (tier === 'dealer' && (product.priceDealerMinor ?? 0) > 0) return product.priceDealerMinor!;
  return product.priceMinor;
}

/** Pack price from a piece price (what the price list and the invoice show). */
export const packPrice = (product: Pick<Product, 'packUnits'>, pieceMinor: number) => pieceMinor * packUnitsOf(product);

/** A pack price typed by the manager, stored per piece (rounded to the qəpik). */
export const pieceFromPack = (packMinor: number, units: number) => Math.round(packMinor / Math.max(1, units));

/** "12 yeşik + 3 ədəd" for a quantity kept in pieces. */
export function qtyLabel(product: Pick<Product, 'packUnits' | 'packName' | 'unit'>, pieces: number, lang: Lang): string {
  const per = packUnitsOf(product);
  const unit = unitLabel(product, lang);
  if (per <= 1 || !product.packName) return `${pieces} ${unit}`;
  const packs = Math.floor(pieces / per);
  const rest = pieces % per;
  const pack = packLabel(product, lang);
  if (!packs) return `${rest} ${unit}`;
  return rest ? `${packs} ${pack} + ${rest} ${unit}` : `${packs} ${pack}`;
}

/** Splits a piece count into whole packs and loose pieces. */
export const splitQty = (product: Pick<Product, 'packUnits'>, pieces: number) => {
  const per = packUnitsOf(product);
  return { packs: Math.floor(pieces / per), pieces: pieces % per };
};

/** A customer as customer.list returns it (the core's CUSTOMER_PROJECTION_SQL). */
export type Customer = {
  id: string; name: string; phone: string; loyaltyCard?: string | null; creditAllowed: number | boolean; creditLimitMinor: number;
  balanceMinor: number; loyaltyMinor?: number; priceTier: PriceTier; voen: string; address: string; note: string;
};

/** What the customer may still take on credit (0 when credit is off). */
export const creditLeft = (customer: Customer) => (customer.creditAllowed ? Math.max(0, customer.creditLimitMinor - customer.balanceMinor) : 0);

/** Amount in words for the invoice ("yüz iyirmi manat 50 qəpik"). */
export function amountInWords(minor: number): string {
  const ones = ['', 'bir', 'iki', 'üç', 'dörd', 'beş', 'altı', 'yeddi', 'səkkiz', 'doqquz'];
  const tens = ['', 'on', 'iyirmi', 'otuz', 'qırx', 'əlli', 'altmış', 'yetmiş', 'səksən', 'doxsan'];
  const hundreds = (n: number) => {
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
    return [h ? `${h > 1 ? `${ones[h]} ` : ''}yüz` : '', tens[t], ones[o]].filter(Boolean).join(' ');
  };
  const manat = Math.floor(minor / 100);
  const qepik = minor % 100;
  const parts: string[] = [];
  const millions = Math.floor(manat / 1_000_000), thousands = Math.floor((manat % 1_000_000) / 1000), rest = manat % 1000;
  if (millions) parts.push(`${hundreds(millions)} milyon`);
  if (thousands) parts.push(thousands === 1 ? 'min' : `${hundreds(thousands)} min`);
  if (rest) parts.push(hundreds(rest));
  const words = parts.join(' ') || 'sıfır';
  return `${words} manat ${String(qepik).padStart(2, '0')} qəpik`;
}

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits');
  const sum = [...first12].reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * An in-store EAN-13 for goods without a maker's barcode (the 20-29 prefix is
 * GS1's range for numbers a shop assigns itself). Printed on the tag, it scans
 * like any other.
 */
export function nextInternalBarcode(taken: Set<string>, start = Date.now() % 1_000_000_000): string {
  for (let n = start; ; n += 1) {
    const body = `20${String(n % 10_000_000_000).padStart(10, '0')}`;
    const code = `${body}${ean13CheckDigit(body)}`;
    if (!taken.has(code)) return code;
  }
}
