#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'database', 'migrations', '010_milioner_brand_menu.sql');
const OUT_PATH = path.join(ROOT, 'docs', 'design', 'milioner-1.2.0', 'asset-spec.json');
const sql = fs.readFileSync(SQL_PATH, 'utf8');

const categories = [];
const categoryPattern =
  /SELECT '([^']+)' AS id, '([^']+)' AS name_az, '([^']+)' AS name_tr, '([^']+)' AS name_en/g;
for (const match of sql.matchAll(categoryPattern)) {
  categories.push({ id: match[1], nameAz: match[2], nameTr: match[3], nameEn: match[4] });
}

const products = [];
const productPattern =
  /SELECT '([^']+)','([^']+)','([^']*)','([^']*)','([^']*)','([^']*)'/g;
for (const match of sql.matchAll(productPattern)) {
  if (!match[1].startsWith('itm-')) continue;
  products.push({
    id: match[1],
    categoryId: match[2],
    sku: match[3],
    nameAz: match[4],
    nameTr: match[5],
    nameEn: match[6],
  });
}

const tables = [
  ['Nar bağı', 'round white Carrara marble with a restrained pomegranate-red stone inlay, four warm ivory chairs'],
  ['Xəzər', 'square pearl ceramic with a faint Caspian teal glass line, four ivory boucle chairs'],
  ['Şuşa', 'oval warm-white limestone with a subtle Şuşa geometric brass detail, four cream chairs'],
  ['İçərişəhər', 'rectangular ivory travertine with honey-stone edging, six cream leather chairs'],
  ['Muğam', 'round alabaster top with a delicate radial tar-string motif, four ivory velvet chairs'],
  ['Karvansara', 'long cream marble communal table with six fluted ivory chairs and small brass details'],
  ['Alov', 'round white marble with a restrained flame-shaped amber inlay, four pearl chairs'],
  ['Sahil', 'rounded rectangular ivory terrazzo with a fine sea-glass line, four cream chairs'],
  ['Qobustan', 'organic live-edge walnut table with four cognac leather chairs'],
  ['Çinar', 'long walnut slab table with six dark saddle-leather chairs'],
  ['Zəfər', 'round carved walnut table with a restrained eight-point brass medallion, four wood chairs'],
  ['Çay evi', 'square honey onyx tea table with four woven walnut chairs'],
  ['Qala', 'octagonal carved dark-oak table with six traditional patterned chairs'],
  ['Füzuli', 'long walnut and black-resin table with six espresso leather chairs'],
  ['Nizami', 'round cross-cut oak table with four tobacco leather chairs'],
  ['Dəniz', 'square warm stone and walnut mosaic table with four cognac chairs'],
  ['Mirvari', 'round polished obsidian with thin pearl and gold veining, four black leather chairs'],
  ['Zəngəzur', 'rectangular smoked glass and black stone table with four charcoal chairs'],
  ['Qız qalası', 'faceted octagonal black-marble table with four sculptural black chairs'],
  ['Səma', 'round black lacquer table with four deep oxblood velvet chairs'],
  ['Abşeron', 'long black marble table with six burgundy velvet chairs and slim brass edging'],
  ['Lalə', 'round fluted smoked-glass table with four wine-red scalloped chairs'],
  ['Zeytun', 'oval charcoal stone table with four black leather chairs and subtle olive-gold detail'],
  ['Bakı gecəsi', 'rectangular starry black marble table with six black velvet chairs and restrained brass points'],
];

const categoryById = new Map(categories.map((category) => [category.id, category]));

function categoryPrompt(category) {
  return `Use case: photorealistic-natural
Asset type: Milioner POS 1.2.0 category cover PNG
Primary request: a premium catalog cover photograph for the Azerbaijani restaurant category “${category.nameAz}”
Scene/backdrop: dark warm-black stone table in an after-dark Baku lounge, quiet antique-brass detail far in the background
Subject: a carefully composed representative assortment for ${category.nameAz}; recognizable at small touch-screen size
Style/medium: photorealistic editorial restaurant photography
Composition/framing: landscape-friendly centered arrangement, slightly elevated three-quarter camera, clean outer margins
Lighting/mood: warm directional restaurant light, realistic appetizing texture, controlled shadows
Color palette: natural food colors, obsidian, warm ivory and restrained brass
Constraints: no people; no text; no menu labels; no logos; no watermark; no repeated plate; no purple or blue gradient`;
}

function specialProductSubject(product) {
  if (product.id === 'itm-ql-01') {
    return 'a traditional Azerbaijani hookah mounted through an ornate handmade clay pot base, clearly different from fruit hookahs';
  }
  if (product.id === 'itm-ql-02') {
    return 'a premium hookah mounted through a freshly cut pink grapefruit base, grapefruit flesh clearly visible';
  }
  if (product.id === 'itm-ql-03') {
    return 'a premium hookah mounted through a whole ripe pineapple base, pineapple silhouette clearly visible';
  }
  return product.nameAz;
}

function productPrompt(product) {
  const category = categoryById.get(product.categoryId);
  const brandedDrink =
    product.categoryId === 'cat-cold-m' ||
    product.categoryId === 'cat-alcohol' ||
    product.categoryId === 'cat-beer';
  return `Use case: photorealistic-natural
Asset type: Milioner POS 1.2.0 individual product PNG
Primary request: an appetizing, accurate restaurant catalog photograph for “${product.nameAz}”
Scene/backdrop: dark warm-black stone tabletop in the same premium after-dark Baku lounge visual world
Subject: ${specialProductSubject(product)}; menu category: ${category?.nameAz ?? product.categoryId}
Style/medium: photorealistic editorial restaurant food and beverage photography
Composition/framing: one centered product or serving, three-quarter elevated camera, square crop, generous safe margins, clear silhouette at 300px UI size
Lighting/mood: warm soft key light from upper left, realistic texture, controlled shadow, subtle antique-brass bokeh
Color palette: natural food or drink colors against obsidian and warm ivory
Constraints: no people; no hands; no text; no price; no watermark; ${brandedDrink ? 'use an elegant generic bottle, glass or can with no brand logo and no fake label text;' : ''} do not add unrelated side dishes; keep this product visually distinct from other menu items`;
}

function tablePrompt(name, material, index) {
  return `Use case: product-mockup
Asset type: Milioner POS 1.2.0 unique table PNG ${String(index + 1).padStart(2, '0')} of 24
Primary request: a single luxury restaurant furniture vignette for the table named “${name}”
Scene/backdrop: seamless near-black matte studio floor with a very subtle warm vignette
Subject: ${material}
Style/medium: photorealistic premium furniture product photography
Composition/framing: perfectly top-down orthographic-looking view, entire table and every chair fully visible, centered, square image, generous even padding
Lighting/mood: soft controlled overhead light, realistic materials, refined Baku lounge mood
Constraints: exactly one table set; no people; no place-name text; no numbers; no logos; no watermark; no crop; clear silhouette at 176px UI size; do not repeat another table design`;
}

const assets = [
  ...categories.map((category) => ({
    key: `category:${category.id}`,
    type: 'category',
    id: category.id,
    nameAz: category.nameAz,
    output: `apps/desktop/src/renderer/assets/menu/milioner/categories/${category.id}.png`,
    width: 960,
    height: 640,
    prompt: categoryPrompt(category),
    mode: 'built-in-imagegen',
    status: 'pending',
  })),
  ...products.map((product) => ({
    key: `product:${product.id}`,
    type: 'product',
    ...product,
    output: `apps/desktop/src/renderer/assets/menu/milioner/products/${product.id}.png`,
    width: 768,
    height: 768,
    prompt: productPrompt(product),
    mode: 'built-in-imagegen',
    status: 'pending',
  })),
  ...tables.map(([name, material], index) => ({
    key: `table:${String(index + 1).padStart(2, '0')}`,
    type: 'table',
    id: `table-${String(index + 1).padStart(2, '0')}`,
    nameAz: name,
    material,
    output: `apps/desktop/src/renderer/assets/brand/tables-v2/${String(index + 1).padStart(2, '0')}.png`,
    width: 1024,
    height: 1024,
    prompt: tablePrompt(name, material, index),
    mode: 'built-in-imagegen',
    status: 'pending',
  })),
];

if (categories.length !== 14 || products.length !== 118 || tables.length !== 24 || assets.length !== 156) {
  throw new Error(
    `Unexpected counts: categories=${categories.length}, products=${products.length}, tables=${tables.length}, assets=${assets.length}`,
  );
}

const manifest = {
  schemaVersion: 1,
  release: '1.2.0',
  generatedAt: null,
  generator: 'built-in-imagegen',
  visualDirection: {
    palette: ['obsidian', 'antique brass', 'oxblood', 'warm ivory'],
    productCamera: 'three-quarter elevated',
    tableCamera: 'top-down',
    noThirdPartyLogos: true,
  },
  counts: { categories: categories.length, products: products.length, tables: tables.length, total: assets.length },
  sourceSql: path.relative(ROOT, SQL_PATH).replaceAll('\\', '/'),
  sourceSqlSha256: createHash('sha256').update(sql).digest('hex'),
  assets,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`[visual-manifest] wrote ${path.relative(ROOT, OUT_PATH)} with ${assets.length} assets\n`);
