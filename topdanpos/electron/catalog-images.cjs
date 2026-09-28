const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

function catalogMediaDir(userData) {
  return path.join(userData, 'catalog-media');
}

function absolutize(url, controlOrigin) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${controlOrigin}${value}`;
  return '';
}

function remoteImageUrl(image, controlOrigin) {
  if (!image || image.kind !== 'url') return '';
  return absolutize(image.remoteUrl || image.url, controlOrigin);
}

function cacheFilename(remoteUrl) {
  const catalog = /\/public\/market-catalog\/([0-9a-f-]{36}\.webp)(?:\?.*)?$/i.exec(remoteUrl);
  if (catalog) return catalog[1].toLowerCase();
  return `${createHash('sha256').update(remoteUrl).digest('hex').slice(0, 24)}.webp`;
}

function isAllowedImageUrl(remoteUrl, allowedHosts) {
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return allowedHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function publishableImage(image) {
  if (!image || typeof image !== 'object' || image.kind !== 'url') return image;
  const remote = String(image.remoteUrl || '').trim();
  const url = String(image.url || '').trim();
  const httpUrl = /^https?:\/\//i.test(remote) ? remote : (/^https?:\/\//i.test(url) ? url : '');
  const dataUrl = url.startsWith('data:') ? url : (remote.startsWith('data:') ? remote : '');
  if (dataUrl) return { kind: 'url', url: dataUrl, ...(httpUrl ? { remoteUrl: httpUrl } : {}) };
  if (httpUrl) return { kind: 'url', url: httpUrl, remoteUrl: httpUrl };
  return image;
}

function rewriteSyncEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    if (!event || event.kind !== 'product.upsert' || !event.payload?.product) return event;
    return {
      ...event,
      payload: {
        ...event.payload,
        product: {
          ...event.payload.product,
          image: publishableImage(event.payload.product.image),
        },
      },
    };
  });
}

async function cacheCatalogImages({ userData, core, controlOrigin, allowedHosts }) {
  const result = await core.invoke('product.list', { activeOnly: false }, 20000);
  if (!result?.success) return;
  const products = Array.isArray(result.data) ? result.data : [];
  const mediaDir = catalogMediaDir(userData);
  mkdirSync(mediaDir, { recursive: true });
  for (const product of products) {
    const remote = remoteImageUrl(product?.image, controlOrigin);
    if (!remote || !isAllowedImageUrl(remote, allowedHosts)) continue;
    const dest = path.join(mediaDir, cacheFilename(remote));
    try {
      if (existsSync(dest) && statSync(dest).size > 32) continue;
      const response = await net.fetch(remote, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 32 || bytes.length > 8 * 1024 * 1024) continue;
      writeFileSync(dest, bytes, { mode: 0o600 });
    } catch {
      // Offline or a single bad URL must not stall sync.
    }
  }
}

module.exports = {
  cacheCatalogImages,
  cacheFilename,
  rewriteSyncEvents,
};
