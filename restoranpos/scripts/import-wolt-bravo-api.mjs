#!/usr/bin/env node
/**
 * Import Bravo Narimanov Azinko catalog from Wolt restaurant API.
 * Downloads product images into market-pos/public/assets/wolt and regenerates
 * wolt-catalog-reference.json (+ optional data seed helper).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const VENUE_SLUG = process.env.WOLT_VENUE_SLUG || 'bravo-supermarket-narimanov-azinko';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_JSON = valueAfter('--output')
  || path.join(ROOT, 'market-pos/src/wolt-catalog-reference.json');
const DOWNLOAD_DIR = valueAfter('--download-dir')
  || path.join(ROOT, 'market-pos/public/assets/wolt');
const MAX = Number(valueAfter('--max') || 0) || Number.POSITIVE_INFINITY;
const CONCURRENCY = Number(valueAfter('--concurrency') || 12);
const SKIP_DOWNLOAD = process.argv.includes('--skip-download');

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const UA = {
  'User-Agent': 'MarketPos/1.0 (+offline catalog import)',
  Accept: 'application/json',
  'Accept-Language': 'az',
};

async function getJson(url) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function mapPosCategory(woltName) {
  const n = (woltName || '').toLocaleLowerCase('az');
  if (/meyv|tərəvəz|teravez/.test(n)) return 'Meyvə';
  if (/yumurta/.test(n)) return 'Səhər yeməyi';
  if (/çörək|corek|un məhs|un mehs/.test(n)) return 'Çörək';
  if (/süd|sud|pendir|yağ|yag|kərə/.test(n)) return 'Süd';
  if (/su\b|içki|icki|cola|şirə|sire/.test(n) && !/spirtli/.test(n)) return /su\b/.test(n) ? 'Su' : 'İçki';
  if (/şirni|sirni|şokolad|cips|çərəz|cerez/.test(n)) return 'Şirniyyat';
  if (/səhər|seher|yemək|yemek/.test(n)) return 'Səhər yeməyi';
  if (/yuyucu|təmizlik|temizlik|kağız|kagiz|məişət|meiset/.test(n)) return 'Ev';
  return 'Ərzaq';
}

function guessUnit(name) {
  const n = (name || '').toLocaleLowerCase('az');
  if (/\bkq\b|\bkg\b/.test(n)) return 'kq';
  if (/\bl\b|\blitr|\bml\b/.test(n)) return 'əd';
  if (/\bpk\b|\bpaket/.test(n)) return 'pk';
  if (/\bqutu|\bəd\b|\bed\./.test(n)) return 'əd';
  return 'əd';
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const dynamic = await getJson(
  `https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/${VENUE_SLUG}/dynamic/?language=az`,
);
const venueId = dynamic?.venue?.id;
if (!venueId) throw new Error('Venue id not found for slug ' + VENUE_SLUG);
console.error(`Venue ${VENUE_SLUG} → ${venueId}`);

const menu = await getJson(`https://restaurant-api.wolt.com/v4/venues/${venueId}/menu/categories`);
const categories = menu.categories || [];
console.error(`Categories: ${categories.length}`);

const seen = new Set();
const rows = [];

for (const category of categories) {
  if (rows.length >= MAX) break;
  const data = await getJson(
    `https://restaurant-api.wolt.com/v4/venues/${venueId}/menu/categories/${category.id}`,
  );
  const items = data.items || [];
  let accepted = 0;
  for (const item of items) {
    if (rows.length >= MAX) break;
    if (!item?.id || seen.has(item.id)) continue;
    if (item.enabled === false) continue;
    const imageUrl = item.image || item.images?.[0]?.url || '';
    if (!imageUrl || !item.name || !item.baseprice) continue;
    seen.add(item.id);
    rows.push({
      woltId: item.id,
      category: category.name,
      posCategory: mapPosCategory(category.name),
      name: item.name,
      priceMinor: Number(item.baseprice) || 0,
      barcode: String(item.barcode_gtin || '').replace(/\D/g, ''),
      unit: guessUnit(item.name),
      imageUrl,
      sourceUrl: `https://wolt.com/az/aze/baku/venue/${VENUE_SLUG}`,
    });
    accepted += 1;
  }
  console.error(`${category.name}: +${accepted} (total ${rows.length})`);
}

console.error(`Collected ${rows.length} products`);

if (!SKIP_DOWNLOAD) {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  // Clear previous product-*.png to avoid stale mix of numbering schemes
  for (const entry of await fs.readdir(DOWNLOAD_DIR)) {
    if (/^product-\d+\.png$/i.test(entry)) await fs.unlink(path.join(DOWNLOAD_DIR, entry));
  }

  let ok = 0;
  let fail = 0;
  await mapPool(rows, CONCURRENCY, async (row, index) => {
    const fileName = `product-${String(index + 1).padStart(4, '0')}.png`;
    const dest = path.join(DOWNLOAD_DIR, fileName);
    try {
      const response = await fetch(row.imageUrl, {
        headers: { 'User-Agent': UA['User-Agent'] },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await sharp(buffer)
        .flatten({ background: '#ffffff' })
        .resize({ width: 480, height: 360, fit: 'contain', background: '#ffffff' })
        .png({ compressionLevel: 8 })
        .toFile(dest);
      row.assetPath = `./assets/wolt/${fileName}`;
      ok += 1;
      if (ok % 100 === 0) console.error(`Images: ${ok}/${rows.length}`);
    } catch (error) {
      fail += 1;
      row.assetPath = '';
      row.imageError = error instanceof Error ? error.message : String(error);
    }
  });
  console.error(`Images downloaded: ${ok}, failed: ${fail}`);
} else {
  for (const [index, row] of rows.entries()) {
    row.assetPath = `./assets/wolt/product-${String(index + 1).padStart(4, '0')}.png`;
  }
}

await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
await fs.writeFile(OUT_JSON, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ count: rows.length, output: OUT_JSON, sample: rows.slice(0, 2) }, null, 2));
