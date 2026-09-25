import type { Lang } from './types';

/** Short aisle labels used in POS — mapped from Wolt Bravo aisle names. */
export type CatalogAisle = {
  id: string;
  order: number;
  labels: Record<Lang, string>;
};

/** Prefer these ids for sort order and i18n; unknown aisles fall back to raw string. */
export const CATALOG_AISLES: CatalogAisle[] = [
  { id: 'Meyvə-tərəvəz', order: 10, labels: { az: 'Meyvə-tərəvəz', ru: 'Овощи и фрукты', en: 'Fruit & veg' } },
  { id: 'Süd', order: 20, labels: { az: 'Süd məhsulları', ru: 'Молочные', en: 'Dairy' } },
  { id: 'Yumurta', order: 30, labels: { az: 'Yumurta', ru: 'Яйца', en: 'Eggs' } },
  { id: 'Çörək', order: 40, labels: { az: 'Çörək', ru: 'Хлеб', en: 'Bakery' } },
  { id: 'Səhər yeməyi', order: 50, labels: { az: 'Səhər yeməyi', ru: 'Завтрак', en: 'Breakfast' } },
  { id: 'İçkilər', order: 60, labels: { az: 'İçkilər', ru: 'Напитки', en: 'Soft drinks' } },
  { id: 'Spirtli içkilər', order: 70, labels: { az: 'Spirtli içkilər', ru: 'Алкоголь', en: 'Alcohol' } },
  { id: 'Çay', order: 80, labels: { az: 'Çay', ru: 'Чай', en: 'Tea' } },
  { id: 'Qəhvə', order: 90, labels: { az: 'Qəhvə', ru: 'Кофе', en: 'Coffee' } },
  { id: 'Şirniyyat', order: 100, labels: { az: 'Şirniyyat', ru: 'Сладости', en: 'Sweets' } },
  { id: 'Qəlyanaltı', order: 110, labels: { az: 'Qəlyanaltı', ru: 'Снеки', en: 'Snacks' } },
  { id: 'Dəniz məhsulları', order: 120, labels: { az: 'Dəniz məhsulları', ru: 'Морепродукты', en: 'Seafood' } },
  { id: 'Ət-toyuq', order: 130, labels: { az: 'Ət / toyuq', ru: 'Мясо / птица', en: 'Meat & poultry' } },
  { id: 'Dondurulmuş', order: 140, labels: { az: 'Dondurulmuş', ru: 'Заморозка', en: 'Frozen' } },
  { id: 'Hazır yemək', order: 150, labels: { az: 'Hazır yemək', ru: 'Готовая еда', en: 'Ready meals' } },
  { id: 'Konserv', order: 160, labels: { az: 'Konservlər', ru: 'Консервы', en: 'Canned' } },
  { id: 'Bakliyyat', order: 170, labels: { az: 'Makaron / düyü', ru: 'Крупы', en: 'Pasta & grains' } },
  { id: 'Yağ', order: 180, labels: { az: 'Yağlar', ru: 'Масла', en: 'Oils' } },
  { id: 'Sous', order: 190, labels: { az: 'Sous / ədviyyat', ru: 'Соусы', en: 'Sauces' } },
  { id: 'Turşu', order: 200, labels: { az: 'Turşular', ru: 'Соленья', en: 'Pickles' } },
  { id: 'Un-şəkər', order: 210, labels: { az: 'Un / şəkər', ru: 'Мука / сахар', en: 'Baking staples' } },
  { id: 'Sağlam qida', order: 220, labels: { az: 'Sağlam qida', ru: 'ЗОЖ', en: 'Health food' } },
  { id: 'Delikates', order: 230, labels: { az: 'Delikates', ru: 'Деликатесы', en: 'Deli' } },
  { id: 'Uşaq', order: 240, labels: { az: 'Uşaq məhsulları', ru: 'Детские', en: 'Baby' } },
  { id: 'Baxım', order: 250, labels: { az: 'Üz / bədən', ru: 'Уход', en: 'Personal care' } },
  { id: 'Saç', order: 260, labels: { az: 'Saç baxımı', ru: 'Волосы', en: 'Hair care' } },
  { id: 'Ağız', order: 270, labels: { az: 'Ağız baxımı', ru: 'Гигиена рта', en: 'Oral care' } },
  { id: 'Təmizlik', order: 280, labels: { az: 'Təmizlik', ru: 'Уборка', en: 'Cleaning' } },
  { id: 'Yuyucu', order: 290, labels: { az: 'Yuyucu vasitələr', ru: 'Стирка', en: 'Laundry' } },
  { id: 'Kağız', order: 300, labels: { az: 'Kağız məhsulları', ru: 'Бумага', en: 'Paper goods' } },
  { id: 'Ev', order: 310, labels: { az: 'Ev / xırdavat', ru: 'Дом', en: 'Household' } },
  { id: 'Heyvan', order: 320, labels: { az: 'Ev heyvanları', ru: 'Питомцы', en: 'Pets' } },
  { id: 'Tütün', order: 330, labels: { az: 'Tütün', ru: 'Табак', en: 'Tobacco' } },
  { id: 'Digər', order: 900, labels: { az: 'Digər', ru: 'Другое', en: 'Other' } },
];

const aisleById = new Map(CATALOG_AISLES.map((aisle) => [aisle.id, aisle]));

/** Map raw Wolt Bravo aisle → short POS aisle id. */
const WOLT_AISLE_MAP: Record<string, string> = {
  'Meyvə və Tərəvəzlər': 'Meyvə-tərəvəz',
  'Süd Məhsulları': 'Süd',
  Yumurtalar: 'Yumurta',
  'Çörəklər və Un Məmulatları': 'Çörək',
  'Səhər Yeməkləri': 'Səhər yeməyi',
  'Spirtsiz İçkilər': 'İçkilər',
  'Spirtli İçkilər': 'Spirtli içkilər',
  Çaylar: 'Çay',
  'Qəhvə və Kakaolar': 'Qəhvə',
  Şirniyyatlar: 'Şirniyyat',
  'Şirin Ləzzətlər': 'Şirniyyat',
  'Çips, Çərəz və Qəlyanaltılar': 'Qəlyanaltı',
  'Dəniz Məhsulları və Hisə Verilmiş Balıqlar': 'Dəniz məhsulları',
  'Toyuq Məhsulları': 'Ət-toyuq',
  'Dondurulmuş Məhsullar': 'Dondurulmuş',
  'Hazır Qidalar': 'Hazır yemək',
  Konservlər: 'Konserv',
  'Makaron, Düyü və Bakliyyat Məhsulları': 'Bakliyyat',
  'Duru Yağlar və Sirkələr': 'Yağ',
  'Sous və Ədviyyat Məhsulları': 'Sous',
  'Turşu Məhsulları': 'Turşu',
  'Şəkər və Un Məhsulları': 'Un-şəkər',
  'Sağlam Qida Məhsulları': 'Sağlam qida',
  'Delikates Məhsulları': 'Delikates',
  'Uşaq Məhsulları': 'Uşaq',
  'Üz və Bədən Baxımı Məhsulları': 'Baxım',
  'Saç Baxımı Məhsulları': 'Saç',
  'Ağız Təravətləndiriciləri': 'Ağız',
  'Təmizlik və Məişət Məhsulları': 'Təmizlik',
  'Yuyucu Vasitələr': 'Yuyucu',
  'Kağız Məhsulları': 'Kağız',
  'Xırdavat və Kiçik Ev Əşyaları ': 'Ev',
  'Xırdavat və Kiçik Ev Əşyaları': 'Ev',
  'Birdəfə İstifadəlik Məhsullar': 'Ev',
  'Ev Heyvanları üçün Məhsullar': 'Heyvan',
  'Tütün Məhsulları': 'Tütün',
  TEREA: 'Tütün',
  'Maşın üçün Aksesuarlar': 'Digər',
  'Açıq Hava və Kempinq üçün': 'Digər',
};

/** Coarse posCategory fallback when Wolt aisle is missing. */
const POS_FALLBACK: Record<string, string> = {
  Meyvə: 'Meyvə-tərəvəz',
  Süd: 'Süd',
  'Səhər yeməyi': 'Səhər yeməyi',
  Çörək: 'Çörək',
  İçki: 'İçkilər',
  Su: 'İçkilər',
  Ərzaq: 'Bakliyyat',
  Şirniyyat: 'Şirniyyat',
  Ev: 'Ev',
};

export function aisleFromWolt(woltCategory?: string, posCategory?: string): string {
  const raw = (woltCategory || '').trim();
  if (raw && WOLT_AISLE_MAP[raw]) return WOLT_AISLE_MAP[raw];
  if (raw && aisleById.has(raw)) return raw;
  const pos = (posCategory || '').trim();
  if (pos && POS_FALLBACK[pos]) return POS_FALLBACK[pos];
  if (pos && aisleById.has(pos)) return pos;
  return 'Digər';
}

export function aisleLabel(id: string, lang: Lang): string {
  return aisleById.get(id)?.labels[lang] ?? id;
}

export function aisleSortKey(id: string): number {
  return aisleById.get(id)?.order ?? 800;
}

export function sortAisleIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => aisleSortKey(a) - aisleSortKey(b) || a.localeCompare(b, 'az'));
}

export const PRODUCT_FORM_AISLES = CATALOG_AISLES.map((aisle) => aisle.id);
