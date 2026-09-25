#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_ROOT = path.join(
  process.env.USERPROFILE ?? 'C:/Users/canur',
  '.codex',
  'generated_images',
  '019fc50c-7e58-7b73-ba5c-ff950c4c5ca8',
);
const OLD_MANIFEST = path.join(ROOT, 'docs', 'design', 'milioner-1.2.0', 'asset-spec.json');
const RELEASE_DIR = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1');
const OUT_MANIFEST = path.join(RELEASE_DIR, 'asset-spec.json');
const LOADING_MANIFEST = path.join(RELEASE_DIR, 'loading', 'loading-manifest.json');

const productSources = {
  'itm-ii-01': ['exec-64dd757b-3a0a-409a-a3e3-bb076e63e335.png', 'Azerbaijani armudu tea beside assorted chocolates; both tea and accompaniment fully visible.'],
  'itm-ii-02': ['exec-98369337-64eb-4254-ac6f-03d619352608.png', 'Azerbaijani armudu tea beside a small bowl of cherry jam; both fully visible.'],
  'itm-ii-03': ['exec-9bd78233-9a26-4e0e-8e6e-1ff00552d1bd.png', 'Large Azerbaijani tea service beside two distinct preserves; tea remains the hero.'],
  'itm-ii-04': ['exec-aeb54f40-af7d-480e-8a25-63654bc2a493.png', 'Azerbaijani armudu tea beside a wrapped cake with exact readable POPKEK label.'],
  'itm-ii-05': ['exec-89950db3-ec37-472c-9c86-abdccdb29ba1.png', 'Azerbaijani armudu tea beside exactly two pieces of baklava.'],
  'itm-ii-06': ['exec-0b4a0e83-05da-4447-b708-d028f9bb0a2d.png', 'Azerbaijani armudu tea beside a chocolate bar with exact readable SNICKERS label.'],
  'itm-ii-07': ['exec-99a639cd-6ddd-4118-b283-d9a54ce036af.png', 'Azerbaijani armudu tea beside sliced chocolate Swiss roll cake.'],
  'itm-ii-08': ['exec-83f7ec90-bfdf-4405-a13e-84d57b78b1df.png', 'Azerbaijani armudu tea beside a small dish of mixed nuts.'],
  'itm-ql-01': ['exec-6bbb09de-b03f-497c-9124-0620d3bf47e7.png', 'Premium hookah with the handmade clay bowl mounted clearly at the top and a glass water base below.'],
  'itm-ql-02': ['exec-b25aca03-c46e-4526-8f4e-bbae48551a2b.png', 'Premium hookah with a cut grapefruit fruit bowl clearly mounted at the top and a glass base below.'],
  'itm-ql-03': ['exec-c55198d0-b945-49f3-a6c0-cefaeeb1d7d4.png', 'Premium hookah with a pineapple fruit bowl clearly mounted at the top and a glass base below.'],
  'itm-si-01': ['exec-6b239241-0f42-4f0d-8d44-f5d6db67df3a.png', 'Chilled red can with exact readable COCA-COLA front label.'],
  'itm-si-02': ['exec-0401bf7c-e739-44f2-ae76-29cfdae9d7b7.png', 'Chilled iced-tea can with exact readable FUSE TEA front label.'],
  'itm-si-03': ['exec-a9388ba7-9989-4a9f-bd02-754b3a051912.png', 'Chilled energy drink can with exact readable HELL front label.'],
  'itm-si-04': ['exec-5537ad37-66ed-484b-a9e5-f5839e607734.png', 'Chilled energy drink can with exact readable BIZON front label.'],
  'itm-si-05': ['exec-1b11a5a5-5078-4a1f-8655-e09a626dda47.png', 'Sparkling mineral-water glass bottle with exact readable SIRAB QAZLI label.'],
  'itm-si-06': ['exec-a4804b07-d8de-4a06-8424-b66280ffb065.png', 'Still mineral-water glass bottle with exact readable SIRAB QAZSIZ label.'],
  'itm-si-07': ['exec-ce1f807b-7bbf-4e90-9f57-1b583622edcf.png', 'Chilled mineral-water bottle with exact readable SARIKIZ label.'],
  'itm-si-08': ['exec-6e9e9584-8f34-4f59-9d91-dea27a8a31f4.png', 'Chilled black-and-gold energy drink can with exact readable POWER label.'],
  'itm-al-01': ['exec-18469085-ddda-4acd-978f-505d9fbeb32d.png', 'Green whiskey bottle and tumbler with exact readable JAMESON label.'],
  'itm-al-02': ['exec-99669da3-0f7f-4f81-ae2d-c0ef79f868e6.png', 'Whisky bottle and tumbler with exact readable CHIVAS label.'],
  'itm-al-03': ['exec-7e8913dd-83b6-4eeb-8882-9ca90d9f58e0.png', 'Tequila bottle, shot and lime with exact readable OLMECA label.'],
  'itm-pv-01': ['exec-5eddf550-f433-4cee-8483-7937c3870b28.png', 'Chilled beer bottle with exact readable NZS front label.'],
  'itm-pv-02': ['exec-03a6bb45-ff35-42e0-8eb3-ea3be7df0e4e.png', 'Chilled beer bottle and glass with exact readable XIRDALAN label.'],
  'itm-pv-03': ['exec-53af0a07-0dc9-48d4-b742-52046e9bc1c0.png', 'Hazy beer bottle and glass with exact readable XIRDALAN NON FILTER label.'],
  'itm-pv-04': ['exec-766bce6d-06c0-4662-ae1f-a1e67c481e1b.png', 'Non-alcoholic beer can and glass with exact readable EFES ZERO label.'],
  'itm-pv-05': ['exec-8a59cdf3-bcc7-4c2f-beb1-7930a4aaadbd.png', 'Tall draft beer on a coaster with exact readable EFES DRAFT label.'],
  'itm-pv-06': ['exec-0aece78b-993d-4a06-8612-da19e554a344.png', 'Chilled beer bottle and glass with exact readable BALTIKA label.'],
  'itm-pv-07': ['exec-3ed927de-4fef-4545-85aa-e4b490941214.png', 'Chilled green beer bottle and glass with exact readable HEINEKEN label.'],
  'itm-pv-08': ['exec-ee566fe9-c7be-47f6-8385-718c85d75eb5.png', 'Herbal liqueur bottle and frozen shot with exact readable JÄGERMEISTER label.'],
};

const tableSources = [
  ['Şahdağ', 'exec-2e1ec01f-3881-4b4d-8909-c926e19f1695.png', 'white quartz and ivory chairs'],
  ['Qarabağ', 'exec-3e4a7514-b3f3-45a4-84a5-78d561a06754.png', 'dark walnut with copper river and leather chairs'],
  ['Xarıbülbül', 'exec-d0983845-ad06-44d8-bcd3-3b407deedb3b.png', 'four-petal ivory-and-rose statement table'],
  ['Atəşgah', 'exec-fd01ebc1-e542-4fba-94cb-c0aad5025375.png', 'basalt table with an amber fire ring'],
  ['Bulvar', 'exec-0ec24477-f0e8-4257-b1be-f59573e87de0.png', 'smoked glass and sand-tone chairs'],
  ['Muğan', 'exec-c769c02a-871a-498c-b7af-ed8b1ea2d462.png', 'travertine and woven cane chairs'],
  ['Şirvan', 'exec-f5a16095-abd7-4564-a868-4ccbd2f027c9.png', 'carved walnut geometric table'],
  ['Gəncə', 'exec-6121065c-8362-4157-991a-3b541462b4e0.png', 'black marble and burgundy chairs'],
  ['Aran', 'exec-b8a5f4a2-6fd1-457e-b869-dfc08f6896ee.png', 'honey onyx and camel leather chairs'],
  ['Kəpəz', 'exec-b6d3f713-5f23-4d3b-a87f-2734335876fe.png', 'organic charcoal stone and graphite chairs'],
  ['Zəfəran', 'exec-591c4e39-67d5-44cd-8a87-77a2e65e47a6.png', 'oval white marble and saffron velvet chairs'],
  ['Milioner', 'exec-98de4ecf-3fe4-4187-ae58-af18477c85de.png', 'black obsidian, gold pomegranate medallion and oxblood chairs'],
];

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fullPrompt(subject, type) {
  const framing = type === 'table'
    ? 'perfect straight top-down orthographic view, entire table and every chair visible, centered square composition'
    : 'one centered serving, three-quarter elevated camera, square composition with generous safe margins';
  return `Use case: Milioner POS 1.2.1 audited runtime PNG. Subject: ${subject}. Scene: premium after-dark Baku lounge visual world with obsidian, warm ivory and restrained antique brass. Style: photorealistic editorial catalog photography. Composition: ${framing}. Constraints: no people, no hands, no price, no watermark, no unrelated objects, no unreadable fake text.`;
}

async function processImage(sourceName, output, width, height, type) {
  const source = path.join(GENERATED_ROOT, sourceName);
  if (!fs.existsSync(source)) throw new Error(`Missing generated source: ${source}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await sharp(source)
    .rotate()
    .resize(width, height, { fit: 'cover', position: type === 'table' ? 'centre' : 'attention' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: 94, colours: 256, dither: 0.8, effort: 10 })
    .toFile(output);
}

for (const [id, [sourceName]] of Object.entries(productSources)) {
  await processImage(
    sourceName,
    path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'assets', 'menu', 'milioner', 'products', `${id}.png`),
    768,
    768,
    'product',
  );
}

for (let offset = 0; offset < tableSources.length; offset += 1) {
  const [, sourceName] = tableSources[offset];
  await processImage(
    sourceName,
    path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'assets', 'brand', 'tables-v2', `${offset + 25}.png`),
    1024,
    1024,
    'table',
  );
}

const previous = JSON.parse(fs.readFileSync(OLD_MANIFEST, 'utf8'));
const assets = previous.assets.map((asset) => ({
  ...asset,
  prompt: String(asset.prompt).replaceAll('1.2.0', '1.2.1'),
}));

for (const asset of assets) {
  if (asset.type !== 'product') continue;
  const replacement = productSources[asset.id];
  if (!replacement) continue;
  asset.prompt = fullPrompt(replacement[1], 'product');
  asset.generatedSource = replacement[0];
  asset.mode = 'built-in-imagegen';
  asset.processedAt = new Date().toISOString();
}

for (let offset = 0; offset < tableSources.length; offset += 1) {
  const number = offset + 25;
  const [nameAz, sourceName, description] = tableSources[offset];
  assets.push({
    key: `table:${String(number).padStart(2, '0')}`,
    type: 'table',
    id: String(number),
    nameAz,
    output: `apps/desktop/src/renderer/assets/brand/tables-v2/${number}.png`,
    width: 1024,
    height: 1024,
    prompt: fullPrompt(`${nameAz}: ${description}`, 'table'),
    mode: 'built-in-imagegen',
    status: 'generated',
    generatedSource: sourceName,
    processedAt: new Date().toISOString(),
  });
}

const loading = JSON.parse(fs.readFileSync(LOADING_MANIFEST, 'utf8'));
for (const frame of loading.frames) {
  assets.push({
    key: `loading:${String(frame.frame).padStart(2, '0')}`,
    type: 'loading',
    id: String(frame.frame),
    nameAz: `Açılış kadrı ${frame.frame}`,
    output: frame.output,
    width: frame.width,
    height: frame.height,
    prompt: `Milioner POS cinematic opening frame ${frame.frame} of 30; generated from the six audited ImageGen keyframes documented in docs/design/milioner-1.2.1/loading/loading-manifest.json.`,
    mode: 'built-in-imagegen-keyframes-plus-local-frame-interpolation',
    status: 'generated',
    generatedSource: `loading frame ${frame.frame}`,
    processedAt: new Date().toISOString(),
  });
}

for (const asset of assets) {
  const file = path.join(ROOT, asset.output);
  const buffer = fs.readFileSync(file);
  const metadata = await sharp(buffer).metadata();
  asset.sha256 = digest(buffer);
  asset.bytes = buffer.length;
  asset.actualWidth = metadata.width;
  asset.actualHeight = metadata.height;
  asset.status = 'generated';
}

const sourceSql = fs.readFileSync(path.join(ROOT, 'database', 'migrations', '010_milioner_brand_menu.sql'));
const manifest = {
  schemaVersion: 2,
  release: '1.2.1',
  generatedAt: new Date().toISOString(),
  generator: 'built-in-imagegen plus local keyframe interpolation',
  generatedSourceRoot: '%USERPROFILE%/.codex/generated_images/019fc50c-7e58-7b73-ba5c-ff950c4c5ca8',
  loadingKeyframeManifest: 'docs/design/milioner-1.2.1/loading/loading-manifest.json',
  visualDirection: {
    palette: ['obsidian', 'antique brass', 'oxblood', 'warm ivory'],
    productCamera: 'three-quarter elevated',
    tableCamera: 'top-down',
    brandedPackaging: 'exact readable primary product name; no invented microtext',
  },
  counts: { categories: 14, products: 118, tables: 36, loadingFrames: 30, total: 198 },
  sourceSql: 'database/migrations/010_milioner_brand_menu.sql',
  sourceSqlSha256: digest(sourceSql),
  assets,
};

fs.mkdirSync(RELEASE_DIR, { recursive: true });
fs.writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`[visuals-1.2.1] PASS: ${Object.keys(productSources).length} products replaced, 12 tables added, 30 loading frames registered; ${assets.length} total assets.\n`);
