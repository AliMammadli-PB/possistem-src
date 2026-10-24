import type { CatalogProduct } from '@/lib/catalog-products';

export const CATALOG_PAGE_SIZE = 24;
export const DEFAULT_CATALOG_PARENT = 'ticaret-avadanliqlari';

const PARENT_ORDER = [
  'ticaret-avadanliqlari',
  'komputer-avadanliqlari',
  'komputerler',
  'noutbuklar',
  'musahide-sistemleri',
  'sebeke-avadanliqlari',
  'ofis-avadanliqlari',
];

export type CatalogLeaf = {
  name: string;
  slug: string;
  count: number;
  image: string;
};

export type CatalogDepartment = CatalogLeaf & {
  categories: CatalogLeaf[];
};

function firstImage(products: CatalogProduct[]) {
  const png = products.find((item) => /\.png(?:\?|$)/i.test(item.image || ''));
  return png?.image || products.find((item) => item.image)?.image || '';
}

function sortByOrder(slugs: string[]) {
  return [...slugs].sort((a, b) => {
    const ai = PARENT_ORDER.indexOf(a);
    const bi = PARENT_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'az');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function buildCatalogTree(products: CatalogProduct[]): CatalogDepartment[] {
  const grouped = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const slug = product.parentCategorySlug || 'diger';
    const list = grouped.get(slug) ?? [];
    list.push(product);
    grouped.set(slug, list);
  }

  return sortByOrder([...grouped.keys()]).map((parentSlug) => {
    const items = grouped.get(parentSlug) ?? [];
    const byCat = new Map<string, CatalogProduct[]>();
    for (const product of items) {
      const slug = product.categorySlug || product.category || 'diger';
      const list = byCat.get(slug) ?? [];
      list.push(product);
      byCat.set(slug, list);
    }
    const categories = [...byCat.entries()]
      .map(([slug, catItems]) => ({
        slug,
        name: catItems[0]?.category || slug,
        count: catItems.length,
        image: firstImage(catItems),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'az'));

    return {
      slug: parentSlug,
      name: items[0]?.parentCategory || parentSlug,
      count: items.length,
      image: firstImage(items),
      categories,
    };
  });
}

export function catalogHref(opts?: {
  parent?: string;
  category?: string;
  q?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.parent === 'all') params.set('bolme', 'all');
  else if (opts?.parent) params.set('bolme', opts.parent);
  if (opts?.category && opts.category !== 'all') params.set('kateqoriya', opts.category);
  const q = opts?.q?.trim();
  if (q) params.set('q', q);
  if (opts?.page && opts.page > 1) params.set('sehife', String(opts.page));
  const qs = params.toString();
  return qs ? `/mehsul/avadanliq/?${qs}` : '/mehsul/avadanliq/';
}

export function filterCatalogProducts(
  products: CatalogProduct[],
  opts: { parent?: string; category?: string; q?: string },
) {
  const q = opts.q?.trim().toLowerCase() ?? '';
  return products
    .filter((item) => {
      if (opts.parent && opts.parent !== 'all' && item.parentCategorySlug !== opts.parent) return false;
      if (opts.category && opts.category !== 'all' && item.categorySlug !== opts.category) return false;
      if (!q) return true;
      const hay = `${item.name} ${item.sku} ${item.brand} ${item.category} ${item.parentCategory}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      const ap = typeof a.price === 'number' && a.price > 0 ? a.price : Number.POSITIVE_INFINITY;
      const bp = typeof b.price === 'number' && b.price > 0 ? b.price : Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name, 'az');
    });
}
