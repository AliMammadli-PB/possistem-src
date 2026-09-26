/**
 * What a clothing store sells, ready to pick from: departments, categories,
 * size scales, colours, materials and seasons. The shop starts with no
 * products; these lists only fill the product form.
 */
import type { Lang, Product } from './types';

type Labels = Record<Lang, string>;

export const GENDERS: Array<{ id: string; labels: Labels }> = [
  { id: 'Kişi', labels: { az: 'Kişi', ru: 'Мужское', en: 'Men' } },
  { id: 'Qadın', labels: { az: 'Qadın', ru: 'Женское', en: 'Women' } },
  { id: 'Oğlan', labels: { az: 'Oğlan uşaq', ru: 'Мальчики', en: 'Boys' } },
  { id: 'Qız', labels: { az: 'Qız uşaq', ru: 'Девочки', en: 'Girls' } },
  { id: 'Körpə', labels: { az: 'Körpə', ru: 'Малыши', en: 'Baby' } },
  { id: 'Unisex', labels: { az: 'Unisex', ru: 'Унисекс', en: 'Unisex' } },
];

/** Icon ids are drawn by ApparelIcon; `scale` is the size scale a new model of this kind starts with. */
export type ApparelCategory = { id: string; order: number; icon: string; scale: string; labels: Labels };

export const APPAREL_CATEGORIES: ApparelCategory[] = [
  { id: 'Köynək', order: 10, icon: 'shirt', scale: 'alpha', labels: { az: 'Köynək', ru: 'Рубашки', en: 'Shirts' } },
  { id: 'Futbolka', order: 20, icon: 'tee', scale: 'alpha', labels: { az: 'Futbolka', ru: 'Футболки', en: 'T-shirts' } },
  { id: 'Polo', order: 30, icon: 'tee', scale: 'alpha', labels: { az: 'Polo', ru: 'Поло', en: 'Polo shirts' } },
  { id: 'Bluza', order: 40, icon: 'shirt', scale: 'alpha', labels: { az: 'Bluza', ru: 'Блузки', en: 'Blouses' } },
  { id: 'Sviter', order: 50, icon: 'sweater', scale: 'alpha', labels: { az: 'Sviter / trikotaj', ru: 'Свитеры', en: 'Knitwear' } },
  { id: 'Hudi', order: 60, icon: 'sweater', scale: 'alpha', labels: { az: 'Hudi / sviterşot', ru: 'Худи', en: 'Hoodies' } },
  { id: 'Pencək', order: 70, icon: 'jacket', scale: 'numeric', labels: { az: 'Pencək / blazer', ru: 'Пиджаки', en: 'Blazers' } },
  { id: 'Kostyum', order: 80, icon: 'jacket', scale: 'numeric', labels: { az: 'Kostyum', ru: 'Костюмы', en: 'Suits' } },
  { id: 'Jilet', order: 90, icon: 'vest', scale: 'alpha', labels: { az: 'Jilet', ru: 'Жилеты', en: 'Vests' } },
  { id: 'Gödəkcə', order: 100, icon: 'coat', scale: 'alpha', labels: { az: 'Gödəkcə / kurtka', ru: 'Куртки', en: 'Jackets' } },
  { id: 'Palto', order: 110, icon: 'coat', scale: 'numeric', labels: { az: 'Palto', ru: 'Пальто', en: 'Coats' } },
  { id: 'Şalvar', order: 120, icon: 'trousers', scale: 'numeric', labels: { az: 'Şalvar', ru: 'Брюки', en: 'Trousers' } },
  { id: 'Cins', order: 130, icon: 'trousers', scale: 'jeans', labels: { az: 'Cins', ru: 'Джинсы', en: 'Jeans' } },
  { id: 'Şort', order: 140, icon: 'shorts', scale: 'alpha', labels: { az: 'Şort', ru: 'Шорты', en: 'Shorts' } },
  { id: 'Ətək', order: 150, icon: 'skirt', scale: 'alpha', labels: { az: 'Ətək', ru: 'Юбки', en: 'Skirts' } },
  { id: 'Don', order: 160, icon: 'dress', scale: 'alpha', labels: { az: 'Don / paltar', ru: 'Платья', en: 'Dresses' } },
  { id: 'İdman', order: 170, icon: 'tee', scale: 'alpha', labels: { az: 'İdman geyimi', ru: 'Спортивная одежда', en: 'Sportswear' } },
  { id: 'Alt paltarı', order: 180, icon: 'underwear', scale: 'alpha', labels: { az: 'Alt paltarı', ru: 'Нижнее бельё', en: 'Underwear' } },
  { id: 'Corab', order: 190, icon: 'sock', scale: 'shoe-range', labels: { az: 'Corab', ru: 'Носки', en: 'Socks' } },
  { id: 'Pijama', order: 200, icon: 'tee', scale: 'alpha', labels: { az: 'Pijama / ev geyimi', ru: 'Пижамы', en: 'Sleepwear' } },
  { id: 'Çimərlik', order: 210, icon: 'swim', scale: 'alpha', labels: { az: 'Çimərlik geyimi', ru: 'Пляжная одежда', en: 'Swimwear' } },
  { id: 'Uşaq geyimi', order: 220, icon: 'tee', scale: 'kids', labels: { az: 'Uşaq geyimi', ru: 'Детская одежда', en: 'Kidswear' } },
  { id: 'Ayaqqabı', order: 230, icon: 'shoe', scale: 'shoes', labels: { az: 'Ayaqqabı', ru: 'Обувь', en: 'Shoes' } },
  { id: 'İdman ayaqqabısı', order: 240, icon: 'sneaker', scale: 'shoes', labels: { az: 'İdman ayaqqabısı', ru: 'Кроссовки', en: 'Sneakers' } },
  { id: 'Çəkmə', order: 250, icon: 'boot', scale: 'shoes', labels: { az: 'Çəkmə', ru: 'Сапоги', en: 'Boots' } },
  { id: 'Səndəl', order: 260, icon: 'shoe', scale: 'shoes', labels: { az: 'Səndəl / başmaq', ru: 'Сандалии', en: 'Sandals' } },
  { id: 'Çanta', order: 270, icon: 'bag', scale: 'one', labels: { az: 'Çanta', ru: 'Сумки', en: 'Bags' } },
  { id: 'Kəmər', order: 280, icon: 'belt', scale: 'belt', labels: { az: 'Kəmər', ru: 'Ремни', en: 'Belts' } },
  { id: 'Papaq', order: 290, icon: 'hat', scale: 'one', labels: { az: 'Papaq / şapka', ru: 'Головные уборы', en: 'Hats & caps' } },
  { id: 'Şərf', order: 300, icon: 'scarf', scale: 'one', labels: { az: 'Şərf / şal', ru: 'Шарфы', en: 'Scarves' } },
  { id: 'Əlcək', order: 310, icon: 'glove', scale: 'alpha', labels: { az: 'Əlcək', ru: 'Перчатки', en: 'Gloves' } },
  { id: 'Aksesuar', order: 320, icon: 'tag', scale: 'one', labels: { az: 'Aksesuar', ru: 'Аксессуары', en: 'Accessories' } },
  { id: 'Zinət', order: 330, icon: 'gem', scale: 'one', labels: { az: 'Zinət / bijuteriya', ru: 'Бижутерия', en: 'Jewellery' } },
  { id: 'Digər', order: 900, icon: 'tag', scale: 'one', labels: { az: 'Digər', ru: 'Другое', en: 'Other' } },
];

export const SIZE_SCALES: Array<{ id: string; labels: Labels; sizes: string[] }> = [
  { id: 'alpha', labels: { az: 'Hərfli (XS-XXL)', ru: 'Буквенные', en: 'Letter' }, sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] },
  { id: 'numeric', labels: { az: 'Rəqəmli (40-60)', ru: 'Российские', en: 'Numeric' }, sizes: ['40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60'] },
  { id: 'jeans', labels: { az: 'Cins (bel W)', ru: 'Джинсы W', en: 'Jeans waist' }, sizes: ['W26', 'W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33', 'W34', 'W36', 'W38', 'W40'] },
  { id: 'shoes', labels: { az: 'Ayaqqabı (35-46)', ru: 'Обувь', en: 'Shoes' }, sizes: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  { id: 'kids', labels: { az: 'Uşaq boyu (56-176)', ru: 'Детский рост', en: 'Kids height' }, sizes: ['56', '62', '68', '74', '80', '86', '92', '98', '104', '110', '116', '122', '128', '134', '140', '146', '152', '158', '164', '170', '176'] },
  { id: 'shoe-range', labels: { az: 'Corab (aralıq)', ru: 'Носки', en: 'Sock range' }, sizes: ['35-38', '39-42', '43-46'] },
  { id: 'belt', labels: { az: 'Kəmər (sm)', ru: 'Ремень, см', en: 'Belt, cm' }, sizes: ['85', '90', '95', '100', '105', '110', '115', '120'] },
  { id: 'one', labels: { az: 'Tək ölçü', ru: 'Один размер', en: 'One size' }, sizes: ['Tək ölçü'] },
];

export const COLORS: Array<{ id: string; hex: string; labels: Labels }> = [
  { id: 'Qara', hex: '#1b1b1f', labels: { az: 'Qara', ru: 'Чёрный', en: 'Black' } },
  { id: 'Ağ', hex: '#f4f4f1', labels: { az: 'Ağ', ru: 'Белый', en: 'White' } },
  { id: 'Boz', hex: '#8a8d93', labels: { az: 'Boz', ru: 'Серый', en: 'Grey' } },
  { id: 'Antrasit', hex: '#3d4046', labels: { az: 'Antrasit', ru: 'Антрацит', en: 'Charcoal' } },
  { id: 'Lacivərd', hex: '#1f2f56', labels: { az: 'Lacivərd', ru: 'Тёмно-синий', en: 'Navy' } },
  { id: 'Mavi', hex: '#2f6fd1', labels: { az: 'Mavi', ru: 'Синий', en: 'Blue' } },
  { id: 'Açıq mavi', hex: '#8ec3ea', labels: { az: 'Açıq mavi', ru: 'Голубой', en: 'Light blue' } },
  { id: 'Cins mavi', hex: '#4a6a93', labels: { az: 'Cins mavisi', ru: 'Джинсовый', en: 'Denim' } },
  { id: 'Bej', hex: '#d9c3a0', labels: { az: 'Bej', ru: 'Бежевый', en: 'Beige' } },
  { id: 'Krem', hex: '#efe4cc', labels: { az: 'Krem', ru: 'Кремовый', en: 'Cream' } },
  { id: 'Qəhvəyi', hex: '#6b4429', labels: { az: 'Qəhvəyi', ru: 'Коричневый', en: 'Brown' } },
  { id: 'Kamel', hex: '#b88449', labels: { az: 'Kamel', ru: 'Кэмел', en: 'Camel' } },
  { id: 'Xaki', hex: '#78784a', labels: { az: 'Xaki', ru: 'Хаки', en: 'Khaki' } },
  { id: 'Yaşıl', hex: '#2f8a4e', labels: { az: 'Yaşıl', ru: 'Зелёный', en: 'Green' } },
  { id: 'Zeytun', hex: '#5d6b32', labels: { az: 'Zeytuni', ru: 'Оливковый', en: 'Olive' } },
  { id: 'Qırmızı', hex: '#c9302c', labels: { az: 'Qırmızı', ru: 'Красный', en: 'Red' } },
  { id: 'Bordo', hex: '#6d1f2c', labels: { az: 'Bordo', ru: 'Бордовый', en: 'Burgundy' } },
  { id: 'Çəhrayı', hex: '#e89ab4', labels: { az: 'Çəhrayı', ru: 'Розовый', en: 'Pink' } },
  { id: 'Bənövşəyi', hex: '#6f4a9e', labels: { az: 'Bənövşəyi', ru: 'Фиолетовый', en: 'Purple' } },
  { id: 'Sarı', hex: '#f0c419', labels: { az: 'Sarı', ru: 'Жёлтый', en: 'Yellow' } },
  { id: 'Narıncı', hex: '#ea7a2a', labels: { az: 'Narıncı', ru: 'Оранжевый', en: 'Orange' } },
  { id: 'Firuzəyi', hex: '#2aa7a1', labels: { az: 'Firuzəyi', ru: 'Бирюзовый', en: 'Turquoise' } },
  { id: 'Qızılı', hex: '#c9a349', labels: { az: 'Qızılı', ru: 'Золотой', en: 'Gold' } },
  { id: 'Gümüşü', hex: '#b8bcc2', labels: { az: 'Gümüşü', ru: 'Серебристый', en: 'Silver' } },
  { id: 'Rəngarəng', hex: '#9b59b6', labels: { az: 'Rəngarəng / naxışlı', ru: 'Мультиколор', en: 'Multicolour' } },
];

export const MATERIALS = ['Pambıq', 'Kətan', 'Yun', 'Kaşmir', 'İpək', 'Viskoz', 'Poliester', 'Elastan qarışıq', 'Cins (denim)', 'Trikotaj', 'Flis', 'Təbii dəri', 'Süni dəri', 'Zamşa', 'Tekstil', 'Rezin', 'Metal'];

export const SEASONS: Array<{ id: string; labels: Labels }> = [
  { id: 'Bütün mövsüm', labels: { az: 'Bütün mövsüm', ru: 'Всесезонный', en: 'All season' } },
  { id: 'Yaz-Yay', labels: { az: 'Yaz-Yay', ru: 'Весна-Лето', en: 'Spring-Summer' } },
  { id: 'Payız-Qış', labels: { az: 'Payız-Qış', ru: 'Осень-Зима', en: 'Autumn-Winter' } },
];

const categoryById = new Map(APPAREL_CATEGORIES.map((row) => [row.id, row]));
const colorById = new Map(COLORS.map((row) => [row.id, row]));

export const categoryInfo = (id: string) => categoryById.get(id) ?? categoryById.get('Digər')!;
export const colorHex = (id: string | undefined) => (id ? colorById.get(id)?.hex : undefined);
export const colorLabel = (id: string, lang: Lang) => colorById.get(id)?.labels[lang] ?? id;
export const genderLabel = (id: string, lang: Lang) => GENDERS.find((row) => row.id === id)?.labels[lang] ?? id;
export const scaleFor = (categoryId: string) => SIZE_SCALES.find((row) => row.id === categoryInfo(categoryId).scale) ?? SIZE_SCALES[0]!;

/** EAN-13 check digit for 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits');
  const sum = [...first12].reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * An in-store EAN-13. The 20-29 prefix is GS1's range for numbers a shop
 * assigns itself, so these never collide with a manufacturer's barcode.
 * `taken` is every barcode in the catalogue; the next free number is used.
 */
export function nextInternalBarcode(taken: Set<string>, start = Date.now() % 1_000_000_000): string {
  for (let n = start; ; n += 1) {
    const body = `20${String(n % 10_000_000_000).padStart(10, '0')}`;
    const code = `${body}${ean13CheckDigit(body)}`;
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
}

const skuPart = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[əƏ]/g, 'E')
    .replace(/[ıİ]/g, 'I')
    .replace(/[^\w]/g, '')
    .toUpperCase()
    .slice(0, 6) || 'X';

/** One product per size × colour of a model, each with its own SKU, barcode and opening stock. */
export function buildVariants(
  model: Omit<Product, 'id' | 'sku' | 'barcode' | 'size' | 'color' | 'warehouseStock' | 'stock'>,
  article: string,
  grid: Array<{ color: string; size: string; qty: number; barcode?: string }>,
  taken: Set<string>,
  newId: () => string,
  parentId = newId(),
): { parentId: string; variants: Array<Product & { stock: number }> } {
  const variants = grid.map((cell) => {
    const barcode = cell.barcode?.trim() || nextInternalBarcode(taken);
    taken.add(barcode);
    return {
      ...model,
      id: newId(),
      parentProductId: parentId,
      internalCode: article,
      sku: `${skuPart(article)}-${skuPart(cell.color)}-${skuPart(cell.size)}`,
      barcode,
      color: cell.color,
      size: cell.size,
      accent: colorHex(cell.color) ?? model.accent,
      warehouseStock: {},
      stock: Math.max(0, Math.floor(cell.qty)),
    };
  });
  return { parentId, variants };
}

/** The sale screen shows a model once; its variants are picked by size and colour. */
export type ModelGroup = { key: string; head: Product; variants: Product[] };

export function groupModels(products: Product[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const product of products) {
    const key = product.parentProductId || product.id;
    const group = groups.get(key);
    if (group) group.variants.push(product);
    else groups.set(key, { key, head: product, variants: [product] });
  }
  return [...groups.values()];
}

/** Sizes in the order of their scale, unknown ones after. */
export function sortSizes(sizes: string[]): string[] {
  const order = new Map<string, number>();
  SIZE_SCALES.forEach((scale, s) => scale.sizes.forEach((size, i) => { if (!order.has(size)) order.set(size, s * 100 + i); }));
  return [...new Set(sizes)].sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999) || a.localeCompare(b, 'az', { numeric: true }));
}

/** "Qara · M" for a cart line or a label. */
export const variantLabel = (product: Pick<Product, 'color' | 'size'>, lang: Lang) =>
  [product.color ? colorLabel(product.color, lang) : '', product.size ?? ''].filter(Boolean).join(' · ');
