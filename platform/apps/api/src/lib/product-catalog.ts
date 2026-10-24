import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';

export type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  price: number;
  originalPrice: number;
  brand: string;
  category: string;
  categorySlug: string;
  parentCategory: string;
  parentCategorySlug: string;
  subCategory: string;
  images: string[];
  specs?: { group?: string; name: string; value: string }[];
  stockQuantity?: number;
  inStock: boolean;
  isActive: boolean;
  isHotDeal: boolean;
};

export type ProductOverride = {
  partnerPriceMinor?: number;
  price?: number;
  imageUrl?: string;
  hidden?: boolean;
  stockQuantity?: number;
};

type CatalogFile = {
  source?: string;
  scrapedAt?: string;
  count?: number;
  products: CatalogProduct[];
};

const TRADE_PARENT = 'Ticarət avadanlıqları';

function overridesPath() {
  return env.productOverridesPath;
}

function catalogPath() {
  return env.productCatalogPath;
}

export function productImageDir() {
  return env.productImageDir;
}

export function productImageFile(storedName: string) {
  return path.join(productImageDir(), path.basename(storedName));
}

export function productImagePublicUrl(storedName: string) {
  return `/pos/api/public/products/images/${encodeURIComponent(path.basename(storedName))}`;
}

export async function ensureProductDirs() {
  await mkdir(productImageDir(), { recursive: true });
}

export async function loadOverrides(): Promise<Record<string, ProductOverride>> {
  try {
    const raw = await readFile(overridesPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, ProductOverride>;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveOverrides(overrides: Record<string, ProductOverride>) {
  await ensureProductDirs();
  const target=overridesPath();
  await mkdir(path.dirname(target),{recursive:true});
  const temporary=`${target}.${randomUUID()}.tmp`;
  await writeFile(temporary,`${JSON.stringify(overrides,null,2)}\n`,{encoding:'utf8',mode:0o600});
  await rename(temporary,target);
}

export async function loadCatalogProducts(): Promise<CatalogProduct[]> {
  const raw = await readFile(catalogPath(), 'utf8');
  const parsed = JSON.parse(raw) as CatalogFile;
  const products = Array.isArray(parsed.products) ? parsed.products : [];
  return products.filter((p) => p && typeof p.id === 'string' && p.isActive !== false);
}

function resolveImage(product: CatalogProduct, override?: ProductOverride): string {
  if (override?.imageUrl && override.imageUrl.trim()) return override.imageUrl.trim();
  const first = product.images?.[0];
  return typeof first === 'string' && first ? first : '';
}

function normalizeStockQuantity(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function resolveStockQuantity(product: CatalogProduct, override?: ProductOverride): number {
  if (typeof override?.stockQuantity === 'number' && Number.isFinite(override.stockQuantity)) {
    return normalizeStockQuantity(override.stockQuantity);
  }
  return normalizeStockQuantity(product.stockQuantity, product.inStock ? 1 : 0);
}

export function mergeProduct(product: CatalogProduct, override?: ProductOverride) {
  const price =
    typeof override?.price === 'number' && Number.isFinite(override.price)
      ? override.price
      : product.price;
  const image = resolveImage(product, override);
  const images = Array.isArray(product.images) ? [...product.images] : [];
  if (override?.imageUrl && override.imageUrl.trim()) {
    const custom = override.imageUrl.trim();
    if (!images.includes(custom)) images.unshift(custom);
  }
  const stockQuantity = resolveStockQuantity(product, override);
  const hasAdminPrice =
    typeof override?.price === 'number' && Number.isFinite(override.price) && override.price > 0;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description || product.shortDescription || '',
    shortDescription: product.shortDescription || '',
    brand: product.brand || '',
    category: product.category || '',
    categorySlug: product.categorySlug || '',
    parentCategory: product.parentCategory || '',
    parentCategorySlug: product.parentCategorySlug || '',
    subCategory: product.subCategory || '',
    image,
    images: images.length ? images : image ? [image] : [],
    specs: Array.isArray(product.specs) ? product.specs : [],
    stockQuantity,
    inStock: stockQuantity > 0,
    isHotDeal: Boolean(product.isHotDeal),
    price,
    partnerPrice: Number.isSafeInteger(override?.partnerPriceMinor)&&override!.partnerPriceMinor!>0 ? override!.partnerPriceMinor!/100 : null,
    originalPrice: product.originalPrice,
    hidden: Boolean(override?.hidden),
    hasAdminPrice,
  };
}

function toPublicProduct(merged: ReturnType<typeof mergeProduct>, mode: 'list' | 'detail') {
  const {
    partnerPrice: _privatePartnerPrice,
    originalPrice: _original,
    hidden: _hidden,
    hasAdminPrice: _hasAdminPrice,
    stockQuantity: _stockQuantity,
    price,
    specs,
    images,
    ...rest
  } = merged;
  const publicPrice =
    typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  // Public site: never expose exact stock counts — only availability boolean.
  return {
    ...rest,
    price: publicPrice,
    ...(mode === 'detail' ? { specs, images } : {}),
  };
}

export async function listAdminProducts(opts?: { q?: string; parent?: string }) {
  const [products, overrides] = await Promise.all([loadCatalogProducts(), loadOverrides()]);
  const q = (opts?.q ?? '').trim().toLowerCase();
  const parent = (opts?.parent ?? '').trim();
  return products
    .map((p) => mergeProduct(p, overrides[p.id]))
    .filter((p) => {
      if (parent && p.parentCategory !== parent) return false;
      if (!q) return true;
      const hay = `${p.name} ${p.sku} ${p.brand} ${p.category}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'az'));
}

export async function listPublicTradeProducts() {
  const [products, overrides] = await Promise.all([loadCatalogProducts(), loadOverrides()]);
  return products
    .map((p) => mergeProduct(p, overrides[p.id]))
    .filter((p) => !p.hidden)
    .map((p) => toPublicProduct(p, 'list'))
    .sort(
      (a, b) =>
        a.parentCategory.localeCompare(b.parentCategory, 'az') ||
        a.category.localeCompare(b.category, 'az') ||
        a.name.localeCompare(b.name, 'az'),
    );
}

export async function getPublicTradeProduct(idOrSlug: string) {
  const key = decodeURIComponent(idOrSlug).trim();
  if (!key) return null;
  const [products, overrides] = await Promise.all([loadCatalogProducts(), loadOverrides()]);
  const product = products.find((p) => p.id === key || p.slug === key || p.sku === key);
  if (!product) return null;
  const merged = mergeProduct(product, overrides[product.id]);
  if (merged.hidden) return null;
  return toPublicProduct(merged, 'detail');
}

async function applyProductOverride(
  id: string,
  patch: ProductOverride,
): Promise<ReturnType<typeof mergeProduct> | null> {
  const products = await loadCatalogProducts();
  const product = products.find((p) => p.id === id);
  if (!product) return null;

  const overrides = await loadOverrides();
  const current = { ...(overrides[id] ?? {}) };
  if(patch.partnerPriceMinor!==undefined){
    if(Number.isNaN(patch.partnerPriceMinor))delete current.partnerPriceMinor;
    else current.partnerPriceMinor=patch.partnerPriceMinor;
  }
  if (patch.price !== undefined) {
    if (Number.isNaN(patch.price)) delete current.price;
    else current.price = Number(patch.price);
  }
  if (patch.imageUrl !== undefined) {
    if (!patch.imageUrl) delete current.imageUrl;
    else current.imageUrl = patch.imageUrl;
  }
  if (patch.hidden !== undefined) current.hidden = patch.hidden;
  if (patch.stockQuantity !== undefined) {
    current.stockQuantity = normalizeStockQuantity(patch.stockQuantity);
  }

  if (Object.keys(current).length === 0) delete overrides[id];
  else overrides[id] = current;

  await saveOverrides(overrides);
  return mergeProduct(product, overrides[id]);
}

export async function openProductImageStream(storedName: string) {
  const file = productImageFile(storedName);
  await access(file);
  return createReadStream(file);
}

export { TRADE_PARENT };

// Serialize the read-modify-write so simultaneous stock/price edits retain both changes.
let overrideWrite:Promise<unknown>=Promise.resolve();
export function updateProductOverride(id:string,patch:ProductOverride):Promise<ReturnType<typeof mergeProduct>|null>{
  const task=overrideWrite.then(()=>applyProductOverride(id,patch));
  overrideWrite=task.catch(()=>undefined);return task;
}
export async function listPartnerPrices():Promise<Record<string,number>>{
  const [products,overrides]=await Promise.all([loadCatalogProducts(),loadOverrides()]);
  return Object.fromEntries(products.filter(p=>!overrides[p.id]?.hidden).flatMap(p=>{
    const value=overrides[p.id]?.partnerPriceMinor;
    return Number.isSafeInteger(value)&&value!>0?[[p.id,value!/100]]:[];
  }));
}
