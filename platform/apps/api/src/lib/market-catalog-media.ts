import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../env.js';

export const MARKET_CATALOG_FILE = /^[0-9a-f-]{36}\.webp$/i;
export const MAX_MARKET_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export function marketCatalogDir() {
  return path.join(env.productImageDir, 'market-catalog');
}

export function marketCatalogPublicUrl(storedName: string) {
  const relative = `/pos/api/public/market-catalog/${encodeURIComponent(path.basename(storedName))}`;
  try {
    return `${new URL(env.customerPortalUrl).origin}${relative}`;
  } catch {
    return relative;
  }
}

export async function ensureMarketCatalogDir() {
  await mkdir(marketCatalogDir(), { recursive: true });
}

export function isAllowedMarketImageMime(mime: string) {
  const value = (mime || '').toLowerCase();
  if (!value || value === 'application/octet-stream') return true;
  if (value.startsWith('image/')) return true;
  return ALLOWED_MIME.has(value);
}

export async function encodeMarketCatalogWebp(buffer: Buffer) {
  if (buffer.length > MAX_MARKET_IMAGE_BYTES) {
    throw new Error('too-large');
  }
  return sharp(buffer, {limitInputPixels:20_000_000,failOn:'error'})
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

export async function encodeMarketCatalogDisplay(buffer: Buffer) {
  return sharp(buffer, {limitInputPixels:20_000_000,failOn:'error'})
    .rotate()
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
}

export function marketCatalogDataUrl(webp: Buffer) {
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

export function marketCatalogStoredName(url: string) {
  const match = /\/public\/market-catalog\/([0-9a-f-]{36}\.webp)(?:\?.*)?$/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

export async function hydrateTillCatalogImage(image: {
  kind: string;
  url?: string;
  remoteUrl?: string;
  index?: number;
}) {
  if (!image || image.kind !== 'url') return image;
  const url = String(image.url || '').trim();
  const remote = String(image.remoteUrl || '').trim();
  const httpUrl = /^https?:\/\//i.test(remote) ? remote : (/^https?:\/\//i.test(url) ? url : '');
  if (url.startsWith('data:')) {
    return httpUrl ? { kind: 'url' as const, url, remoteUrl: httpUrl } : image;
  }
  const stored = marketCatalogStoredName(httpUrl || url);
  if (!stored) return image;
  try {
    const webp = await readFile(path.join(marketCatalogDir(), stored));
    const display = await encodeMarketCatalogDisplay(webp);
    return {
      kind: 'url' as const,
      url: marketCatalogDataUrl(display),
      remoteUrl: httpUrl || marketCatalogPublicUrl(stored),
    };
  } catch {
    return image;
  }
}

export async function saveMarketCatalogWebp(webp: Buffer) {
  await ensureMarketCatalogDir();
  const storedName = `${randomUUID()}.webp`;
  await writeFile(path.join(marketCatalogDir(), storedName), webp, { mode: 0o644 });
  return storedName;
}

export async function openMarketCatalogStream(file: string) {
  const stored = path.basename(file);
  if (!MARKET_CATALOG_FILE.test(stored)) {
    throw new Error('not-found');
  }
  const full = path.join(marketCatalogDir(), stored);
  await access(full);
  return createReadStream(full);
}
