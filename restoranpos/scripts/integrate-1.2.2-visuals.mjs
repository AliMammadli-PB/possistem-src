#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIOUS_MANIFEST = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'asset-spec.json');
const RELEASE_DIR = path.join(ROOT, 'docs', 'design', 'milioner-1.2.2');
const OUT_MANIFEST = path.join(RELEASE_DIR, 'asset-spec.json');

const additions = [
  {
    key: 'category:cat-extras',
    type: 'category',
    id: 'cat-extras',
    nameAz: 'Əlavələr',
    output: 'apps/desktop/src/renderer/assets/menu/milioner/categories/cat-extras.png',
    width: 960,
    height: 640,
    generatedSource: 'exec-27d85858-c0d4-4b2f-b01b-b33426788514.png',
    prompt: 'Use case: Milioner POS 1.2.2 premium category cover. A representative extras assortment with flatbread, spices, herbs, butter, citrus and pomegranate on dark obsidian marble; warm brass and oxblood accents; editorial restaurant photography; no people, text, logos or watermark.',
  },
  {
    key: 'category:cat-fish',
    type: 'category',
    id: 'cat-fish',
    nameAz: 'Balıq Yeməkləri',
    output: 'apps/desktop/src/renderer/assets/menu/milioner/categories/cat-fish.png',
    width: 960,
    height: 640,
    generatedSource: 'exec-8ef1f102-d97d-4bb4-9fd6-b134f92db179.png',
    prompt: 'Use case: Milioner POS 1.2.2 premium category cover. Whole grilled trout and fillets with lemon, dill and pomegranate on dark obsidian stone; warm brass and oxblood accents; editorial restaurant photography; no people, text, logos or watermark.',
  },
];

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const previous = JSON.parse(fs.readFileSync(PREVIOUS_MANIFEST, 'utf8'));
const assets = previous.assets
  .filter((asset) => !additions.some((addition) => addition.key === asset.key))
  .map((asset) => ({
    ...asset,
    prompt: String(asset.prompt).replaceAll('1.2.1', '1.2.2'),
  }));

for (const addition of additions) {
  assets.push({
    ...addition,
    mode: 'built-in-imagegen',
    status: 'generated',
    processedAt: new Date().toISOString(),
  });
}

for (const asset of assets) {
  const file = path.join(ROOT, asset.output);
  if (!fs.existsSync(file)) throw new Error(`Missing visual asset: ${asset.output}`);
  const buffer = fs.readFileSync(file);
  const metadata = await sharp(buffer).metadata();
  asset.sha256 = digest(buffer);
  asset.bytes = buffer.length;
  asset.actualWidth = metadata.width;
  asset.actualHeight = metadata.height;
  asset.status = 'generated';
}

const sourceSql = fs.readFileSync(path.join(ROOT, 'database', 'migrations', '020_legacy_menu_drafts.sql'));
const counts = {
  categories: assets.filter((asset) => asset.type === 'category').length,
  products: assets.filter((asset) => asset.type === 'product').length,
  tables: assets.filter((asset) => asset.type === 'table').length,
  loadingFrames: assets.filter((asset) => asset.type === 'loading').length,
  total: assets.length,
};

if (
  counts.categories !== 16 ||
  counts.products !== 118 ||
  counts.tables !== 36 ||
  counts.loadingFrames !== 30 ||
  counts.total !== 200
) {
  throw new Error(`Unexpected visual counts: ${JSON.stringify(counts)}`);
}

const manifest = {
  schemaVersion: 3,
  release: '1.2.2',
  generatedAt: new Date().toISOString(),
  generator: 'built-in-imagegen plus local keyframe interpolation',
  generatedSourceRoot: '%USERPROFILE%/.codex/generated_images/019fc50c-7e58-7b73-ba5c-ff950c4c5ca8',
  loadingKeyframeManifest: 'docs/design/milioner-1.2.1/loading/loading-manifest.json',
  visualDirection: previous.visualDirection,
  counts,
  sourceSql: 'database/migrations/020_legacy_menu_drafts.sql',
  sourceSqlSha256: digest(sourceSql),
  assets,
};

fs.mkdirSync(RELEASE_DIR, { recursive: true });
fs.writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`[visuals-1.2.2] PASS: ${counts.total} audited PNGs registered.\n`);
