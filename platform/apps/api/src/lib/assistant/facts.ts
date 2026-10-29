/**
 * Live facts the assistant quotes: plan prices, the package builder, support
 * hours and the hardware catalogue. They come from the same public endpoints
 * the website renders (in-process via inject), so the chat never disagrees
 * with the page the customer is looking at.
 */
import type { FastifyInstance } from 'fastify';
import { fold, type Lang } from './text.js';

type Cached = { at: number; value: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 60_000;

async function getJson<T>(app: FastifyInstance, url: string): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  try {
    const res = await app.inject({ method: 'GET', url });
    if (res.statusCode !== 200) return null;
    const value = res.json() as T;
    cache.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

export const azn = (minor: number) => {
  const value = Math.round(minor) / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)} ₼`;
};

type Plan = { id: string; monthlyPriceMinor?: number | string | null; content?: Record<string, { name?: string; tagline?: string; features?: string[] }> };
/** The site shows these when the admin price is still 0 (src/lib/pricing.ts). */
const FALLBACK_MONTHLY: Record<string, number> = { standart: 4900, biznes: 8900, premium: 14900 };

export async function plans(app: FastifyInstance, lang: Lang) {
  const data = await getJson<{ plans: Plan[] }>(app, '/pos/api/subscription-plans');
  const list = data?.plans ?? [];
  return list.map((p) => {
    const c = p.content?.[lang] ?? p.content?.az ?? {};
    const raw = Number(p.monthlyPriceMinor);
    return {
      id: p.id,
      name: c.name ?? p.id,
      tagline: c.tagline ?? '',
      features: c.features ?? [],
      monthlyMinor: Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_MONTHLY[p.id] ?? 0,
    };
  });
}

type BuilderItem = { id: string; kind: string; billing: string; priceMinor: number; name: Record<Lang, string>; description: Record<Lang, string>; unit?: Record<Lang, string> };
export async function builderItems(app: FastifyInstance) {
  const data = await getJson<{ items: BuilderItem[] }>(app, '/pos/api/package-builder');
  return data?.items ?? [];
}

export async function supportHours(app: FastifyInstance) {
  return getJson<{ isOpen: boolean; start: string; end: string; nextOpen: string | null; weekDays?: number[] }>(app, '/pos/api/public/support/availability');
}

export type CatalogItem = { id: string; name: string; slug?: string; brand?: string; category?: string; parentCategory?: string; inStock?: boolean; price?: number | null; shortDescription?: string };
export async function catalog(app: FastifyInstance): Promise<CatalogItem[]> {
  const data = await getJson<{ products: CatalogItem[] }>(app, '/pos/api/public/products');
  return data?.products ?? [];
}

/** Catalogue items whose category or name matches any of the patterns. */
export async function catalogFind(app: FastifyInstance, pattern: RegExp, limit = 8) {
  const items = await catalog(app);
  const hits = items.filter((p) => pattern.test(fold(`${p.category ?? ''} ${p.parentCategory ?? ''} ${p.name}`)));
  return { total: hits.length, items: hits.slice(0, limit) };
}

export function catalogLines(items: CatalogItem[], lang: Lang): string {
  const ask = lang === 'ru' ? 'цена по запросу' : lang === 'en' ? 'price on request' : 'qiymət sorğu ilə';
  return items
    .map((p) => `• ${p.name}${p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? ` (${p.brand})` : ''} — ${p.price ? azn(p.price * 100) : ask}`)
    .join('\n');
}

/** Words that frame a catalogue question but never name a product. */
const CATALOG_FRAME = new Set(['var', 'varmi', 'sizde', 'sizdə', 'sizden', 'satirsiz', 'satirsiniz', 'satilir', 'satisda', 'qiymeti', 'qiymet', 'neceye', 'neceyedir', 'nece', 'ne', 'qeder', 'model', 'modeli', 'almaq', 'isteyirem', 'lazimdir', 'lazim', 'bir', 'de', 'da', 'mi', 'mu', 've', 'ya', 'yoxsa', 'olar', 'have', 'you', 'do', 'sell', 'any', 'is', 'there', 'a', 'the', 'price', 'есть', 'у', 'вас', 'продаете', 'цена', 'ли']);

export type CatalogSearch = { hits: CatalogItem[]; total: number; brandAsked: string | null; brandKnown: boolean; brands: string[] };

/**
 * Brand / model search over the hardware catalogue: "LG var sizdə?", "x printer varmı",
 * "hp noutbuk". Adjacent short tokens are also tried glued ("x printer" → "xprinter").
 */
export async function catalogSearch(app: FastifyInstance, text: string): Promise<CatalogSearch> {
  const items = await catalog(app);
  const brands = [...new Set(items.map((p) => (p.brand ?? '').trim()).filter(Boolean))].sort();
  const brandSet = new Set(brands.map((b) => fold(b)));
  const words = fold(text).split(' ').filter((w) => w && !CATALOG_FRAME.has(w));
  const tokens = new Set<string>(words.filter((w) => w.length >= 2));
  for (let i = 0; i + 1 < words.length; i += 1) tokens.add(words[i]! + words[i + 1]!);
  const brandAsked = [...tokens].find((t) => brandSet.has(t)) ?? (words.length === 1 && words[0]!.length <= 8 ? words[0]! : null);
  const haystack = items.map((p) => ({ p, text: ` ${fold(`${p.brand ?? ''} ${p.name} ${p.category ?? ''}`)} ` }));
  const scored = haystack.map(({ p, text: h }) => ({ p, score: [...tokens].filter((t) => h.includes(` ${t}`) || (t.length >= 4 && h.includes(t))).length })).filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  const hits = scored.filter((x) => x.score === best).map((x) => x.p);
  return { hits: hits.slice(0, 8), total: hits.length, brandAsked, brandKnown: Boolean(brandAsked && brandSet.has(brandAsked)), brands };
}
