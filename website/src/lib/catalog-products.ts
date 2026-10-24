export type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  brand: string;
  category: string;
  categorySlug: string;
  parentCategory: string;
  parentCategorySlug: string;
  subCategory: string;
  image: string;
  images?: string[];
  specs?: { group?: string; name: string; value: string }[];
  stockQuantity?: number;
  inStock: boolean;
  isHotDeal: boolean;
  price?: number | null;
};

export type CatalogResponse = {
  count: number;
  categories: string[];
  parents?: string[];
  products: CatalogProduct[];
};

export function productDetailPath(product: Pick<CatalogProduct, 'id'>) {
  return `/mehsul/avadanliq/${encodeURIComponent(product.id)}/`;
}

export function stockRemaining(product: Pick<CatalogProduct, 'stockQuantity' | 'inStock'>): number {
  const n = Number(product.stockQuantity);
  if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  // Public API may omit exact stock — treat inStock as available (cart qty capped softly).
  if (product.inStock === false) return 0;
  return 99;
}

export function hasPublicPrice(product: Pick<CatalogProduct, 'price'>): product is CatalogProduct & { price: number } {
  return typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0;
}

export async function fetchPublicCatalog(): Promise<CatalogResponse> {
  const res = await fetch('/pos/api/public/products', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Catalog HTTP ${res.status}`);
  }
  return (await res.json()) as CatalogResponse;
}

export async function fetchPublicProduct(id: string): Promise<CatalogProduct> {
  const res = await fetch(`/pos/api/public/products/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Product HTTP ${res.status}`);
  }
  const data = (await res.json()) as { product: CatalogProduct };
  return data.product;
}
