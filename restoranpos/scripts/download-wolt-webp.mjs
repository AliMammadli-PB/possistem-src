#!/usr/bin/env node
/**
 * Download all catalog product images as WebP into market-pos/public/assets/wolt
 * and rewrite assetPath in wolt-catalog-reference.json (resume-safe).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CATALOG = valueAfter('--catalog')
  || path.join(ROOT, 'market-pos/src/wolt-catalog-reference.json');
const DOWNLOAD_DIR = valueAfter('--download-dir')
  || path.join(ROOT, 'market-pos/public/assets/wolt');
const CONCURRENCY = Number(valueAfter('--concurrency') || 16);
const QUALITY = Number(valueAfter('--quality') || 72);
const RETRIES = Number(valueAfter('--retries') || 2);

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

async function fileOk(filePath) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile() && st.size > 200;
  } catch {
    return false;
  }
}

const rows = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
if (!Array.isArray(rows) || !rows.length) throw new Error('Catalog empty');

await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

// Remove legacy PNG assets so only WebP remains as defaults
for (const entry of await fs.readdir(DOWNLOAD_DIR)) {
  if (/^product-\d+\.png$/i.test(entry)) {
    await fs.unlink(path.join(DOWNLOAD_DIR, entry));
  }
}

let ok = 0;
let skipped = 0;
let fail = 0;
const failed = [];

console.error(`Downloading ${rows.length} WebP images → ${DOWNLOAD_DIR}`);

await mapPool(rows, CONCURRENCY, async (row, index) => {
  const fileName = `product-${String(index + 1).padStart(4, '0')}.webp`;
  const dest = path.join(DOWNLOAD_DIR, fileName);
  row.assetPath = `./assets/wolt/${fileName}`;

  if (await fileOk(dest)) {
    skipped += 1;
    ok += 1;
    if ((ok + fail) % 100 === 0) console.error(`progress ${ok + fail}/${rows.length} (ok=${ok} skip=${skipped} fail=${fail})`);
    return;
  }

  const imageUrl = row.imageUrl;
  if (!imageUrl) {
    fail += 1;
    failed.push({ index: index + 1, name: row.name, error: 'missing imageUrl' });
    row.assetPath = '';
    return;
  }

  let lastError = '';
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(imageUrl, {
        headers: { 'User-Agent': 'MarketPos/1.0 (+offline webp catalog)' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await sharp(buffer)
        .flatten({ background: '#ffffff' })
        .resize({ width: 480, height: 360, fit: 'contain', background: '#ffffff' })
        .webp({ quality: QUALITY })
        .toFile(dest);
      ok += 1;
      if (ok % 100 === 0) console.error(`progress ${ok + fail}/${rows.length} (ok=${ok} skip=${skipped} fail=${fail})`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  fail += 1;
  failed.push({ index: index + 1, name: row.name, error: lastError });
  row.assetPath = '';
});

await fs.writeFile(CATALOG, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

const withAsset = rows.filter((r) => r.assetPath).length;
console.log(JSON.stringify({
  total: rows.length,
  ok,
  skipped,
  fail,
  withAssetPath: withAsset,
  catalog: CATALOG,
  downloadDir: DOWNLOAD_DIR,
  failedSample: failed.slice(0, 10),
}, null, 2));

if (fail > rows.length * 0.01) {
  console.error(`WARNING: ${fail} failures (>1%)`);
  process.exitCode = 2;
}
