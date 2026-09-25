/**
 * Generates Milioner menu SQL for seed + migration 010.
 * Run: node scripts/gen-milioner-menu.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cats = [
  ['cat-ff', 'Fast Food', 'Fast Food', 'Fast Food', 'utensils', '#E07B39', 1],
  ['cat-salads-m', 'Salatlar', 'Salatalar', 'Salads', 'leafy-green', '#4FA978', 2],
  ['cat-chicken', 'Toyuq Yeməkləri', 'Tavuk Yemekleri', 'Chicken', 'utensils', '#D9A441', 3],
  ['cat-meat', 'Ət Yeməkləri', 'Et Yemekleri', 'Meat', 'beef', '#C45A5A', 4],
  ['cat-sides', 'Qarnir', 'Garnitür', 'Sides', 'wheat', '#E5CF9B', 5],
  ['cat-cold-mezze', 'Soyuq Məzələr', 'Soğuk Mezeler', 'Cold Mezze', 'salad', '#6A9BC9', 6],
  ['cat-hot-mezze', 'İsti Məzələr', 'Sıcak Mezeler', 'Hot Mezze', 'flame', '#E07B39', 7],
  ['cat-fruit', 'Meyvə', 'Meyve', 'Fruit', 'apple', '#52C08A', 8],
  ['cat-mezze', 'Məzələr', 'Mezeler', 'Mezze', 'utensils', '#C9A86A', 9],
  ['cat-cold-m', 'Soyuq İçkilər', 'Soğuk İçecekler', 'Cold Drinks', 'cup-soda', '#52C08A', 10],
  ['cat-hot-m', 'İsti İçkilər', 'Sıcak İçecekler', 'Hot Drinks', 'coffee', '#8A744A', 11],
  ['cat-alcohol', 'Alkoqollu İçkilər', 'Alkollü İçecekler', 'Alcohol', 'wine', '#B07FC7', 12],
  ['cat-beer', 'Pivələr', 'Bira', 'Beer', 'beer', '#D9A441', 13],
  ['cat-hookah', 'Qəlyan', 'Nargile', 'Hookah', 'flame', '#8A744A', 14],
];

const groups = [
  [
    'cat-ff',
    'FF',
    [
      ['Club Sandwich', 900],
      ['Burger Ət', 900],
      ['Burger Toyuq', 700],
      ['Nuggets', 700],
      ['Şaurma', 700],
      ['Hotdog', 400],
    ],
  ],
  [
    'cat-salads-m',
    'SA',
    [
      ['Sezar Salatı', 800],
      ['Xırt-xırt Badımcan', 500],
      ['Çoban Salatı', 400],
      ['Pomidor Salatı', 400],
    ],
  ],
  [
    'cat-chicken',
    'TY',
    [
      ['Toyuq Langet', 500],
      ['Toyuq Qulyaj', 700],
      ['Tabaka Broiler', 2000],
      ['Tabaka Çolpa', 2200],
      ['Çolpa Çığırtma', 2000],
      ['Çolpa Limon Sousla', 1300],
      ['Fajitos Toyuq', 900],
      ['Qaymaqlı Toyuq', 800],
      ['Şabalıdlı Çolpa', 2000],
      ['Kiyev Kotleti', 700],
      ['Toyuq Sote', 800],
    ],
  ],
  [
    'cat-meat',
    'ET',
    [
      ['Monastr Sayağı Ət', 1200],
      ['Ət Langeti', 900],
      ['Qaymaqlı Can Əti', 1200],
      ['Alballı Can Əti', 1200],
      ['Can Əti Qovurma', 1200],
      ['Ət Sote', 1200],
    ],
  ],
  [
    'cat-sides',
    'QN',
    [
      ['Düyü', 300],
      ['Qarabaşaq', 300],
      ['Spagetti', 300],
      ['Kartof Fri', 300],
      ['Kartof Ev Sayağı', 350],
      ['Soyutma Kartof', 250],
    ],
  ],
  [
    'cat-cold-mezze',
    'SM',
    [
      ['Pendir', 300],
      ['Turşu', 300],
      ['Süzmə', 250],
      ['Acika', 200],
      ['Qatıq', 100],
      ['Yaşıl Zeytun', 300],
      ['Təzə Salat', 300],
      ['Göyərti', 200],
      ['Limon', 100],
    ],
  ],
  [
    'cat-hot-mezze',
    'IM',
    [
      ['Yumurta Pomidor Pendirli', 500],
      ['Yumurta Pomidor', 400],
      ['Sordelka Gürcü', 500],
      ['İveriya Sosiska Gürcü', 500],
      ['Krakov Kolbosa Pomidorlu Pendirli', 700],
      ['Selyodka Kartof ilə', 700],
      ['Sosiska Manqal', 500],
    ],
  ],
  ['cat-fruit', 'MY', [['Meyvə Assorti', 1500]]],
  [
    'cat-mezze',
    'MZ',
    [
      ['Saçaq Pendir Sadə', 350],
      ['Saçaq Pendir Qızartma', 400],
      ['Noxud', 250],
      ['Noxud Qızartma', 300],
      ['Püstə', 700],
      ['Suxari', 200],
      ['Çips', 300],
      ['Fimi Pendirli', 500],
      ['Düşbərə Qızartma', 400],
      ['Patanə Qızartma', 450],
      ['Patanə Souslu Qızartma', 550],
      ['Boğaz Qızartma', 400],
      ['Boğaz Hisə Verilmiş', 400],
      ['Boğaz Qızartma Sousda', 450],
      ['Göbələk Papaqları Pendirli', 500],
      ['Göbələk Suxaridə', 600],
      ['Qrenki Sadə', 400],
      ['Qrenki Pendirli', 500],
      ['Toyuq Qanadları Bufalo', 700],
      ['Toyuq Qanadları Suxaridə', 600],
      ['Hamsi Balıq Suxaridə', 500],
      ['Krivetka Dəniz', 1000],
      ['Krivetka Çay', 1000],
      ['Pendirli Kartof Fri', 500],
      ['Göbələk Çips', 500],
      ['Pendir Çubuqları', 500],
      ['Gürcü Qızartma', 120],
      ['Gürzə Qızartma', 500],
      ['Toyuq Çips', 600],
      ['Toyuq Popcorn', 500],
      ['Bildirçin', 400],
    ],
  ],
  [
    'cat-cold-m',
    'SI',
    [
      ['Coca-Cola (Banka)', 300],
      ['Fuse Tea (Banka)', 300],
      ['Hell', 250],
      ['Bizon', 200],
      ['Sirab Qazlı (Şüşə)', 250],
      ['Sirab Qazsız (Şüşə)', 250],
      ['Sarıkız', 200],
      ['Power', 200],
      ['Meyvə Şirəsi', 400],
      ['Limonat (1L)', 300],
      ['Ayran (Bakal)', 150],
    ],
  ],
  [
    'cat-hot-m',
    'II',
    [
      ['Çay Şokolad', 800],
      ['Çay Mürəbbə (kiçik)', 1000],
      ['Çay Mürəbbə (böyük)', 1200],
      ['Çay Popkek', 900],
      ['Çay Paxlava', 1200],
      ['Çay Snickers', 800],
      ['Çay Rulet', 800],
      ['Çay Çərəz', 1200],
      ['Çay Dəstgahı', 3000],
      ['Çay Dəstgahı (Qəlyan ilə)', 3800],
      ['Kofe', 200],
      ['Cappuccino', 250],
    ],
  ],
  [
    'cat-alcohol',
    'AL',
    [
      ['Viski (Jameson)', 600],
      ['Chivas', 700],
      ['Tekila (Olmeca)', 600],
    ],
  ],
  [
    'cat-beer',
    'PV',
    [
      ['NZS', 150],
      ['Xırdalan', 300],
      ['Xırdalan Non Filter', 350],
      ['Efes Zero', 400],
      ['Efes Draft', 700],
      ['Baltika', 400],
      ['Heineken', 800],
      ['Jägermeister', 700],
    ],
  ],
  [
    'cat-hookah',
    'QL',
    [
      ['Saxsıda', 1500],
      ['Qreyfurt', 2000],
      ['Ananas', 2500],
    ],
  ],
];

function stationFor(cat) {
  if (['cat-cold-m', 'cat-hot-m', 'cat-alcohol', 'cat-beer', 'cat-hookah'].includes(cat)) return 'bar';
  if (['cat-cold-mezze', 'cat-salads-m', 'cat-fruit'].includes(cat)) return 'cold';
  return 'kitchen';
}

function courseFor(cat) {
  if (['cat-cold-m', 'cat-hot-m', 'cat-alcohol', 'cat-beer', 'cat-hookah'].includes(cat)) return 'drinks';
  if (['cat-salads-m', 'cat-cold-mezze'].includes(cat)) return 'starter';
  return 'main';
}

function esc(s) {
  return s.replace(/'/g, "''");
}

const catSql =
  'INSERT INTO menu_categories (id, name_az, name_tr, name_en, icon, accent, image, sort_order, active) VALUES\n' +
  cats
    .map(
      ([id, az, tr, en, icon, accent, order]) =>
        `  ('${id}','${esc(az)}','${esc(tr)}','${esc(en)}','${icon}','${accent}','',${order},1)`,
    )
    .join(',\n') +
  ';\n';

const itemRows = [];
for (const [catId, prefix, list] of groups) {
  list.forEach(([name, price], idx) => {
    const n = String(idx + 1).padStart(2, '0');
    const id = `itm-${prefix.toLowerCase()}-${n}`;
    const sku = `${prefix}-${n}`;
    const st = stationFor(catId);
    const course = courseFor(catId);
    itemRows.push(
      `('${id}','${catId}','${sku}','${esc(name)}','${esc(name)}','${esc(name)}','','','',${price},0,'',10,'${st}','${course}','[]',NULL,0,${idx + 1},0,0)`,
    );
  });
}

const itemSql =
  'INSERT INTO menu_items\n' +
  '  (id, category_id, sku, name_az, name_tr, name_en, description_az, description_tr, description_en,\n' +
  '   price_minor, cost_minor, image, prep_minutes, station, course, allergens, calories,\n' +
  '   popular, sort_order, created_at, updated_at)\n' +
  'VALUES\n' +
  itemRows.join(',\n') +
  ';\n';

const settingsUpsert = `-- Milioner restaurant profile + print defaults
INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('restaurant.name', 'Milioner', 'string', 0),
  ('restaurant.tagline', 'Restoran & Lounge', 'string', 0),
  ('restaurant.address', 'Lütfizadə 98', 'string', 0),
  ('restaurant.phone', '+994505013540', 'string', 0),
  ('restaurant.hours', '12:00 – 02:00', 'string', 0),
  ('restaurant.taxId', '', 'string', 0),
  ('locale.currencyDisplay', 'symbol', 'string', 0),
  ('locale.currency', 'AZN', 'string', 0),
  ('locale.currencySymbol', '₼', 'string', 0),
  ('finance.taxPercent', '0', 'int', 0),
  ('finance.servicePercent', '0', 'int', 0),
  ('finance.taxIncluded', '1', 'bool', 0),
  ('printer.renderMode', 'raster', 'string', 0)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  value_type = excluded.value_type,
  updated_at = excluded.updated_at;
`;

const migration = `-- ============================================================================
-- 010 - Milioner brand, real menu, print defaults
--
-- Fresh installs: only settings + permission (menu comes from seed).
-- Upgrades from Maison Aurelia: deactivate old catalogue and insert Milioner.
-- ============================================================================

${settingsUpsert}

INSERT OR IGNORE INTO permissions (id, key, description) VALUES
  ('perm-users-manage', 'users.manage', 'Create and deactivate local staff accounts');

-- Upgrade-only menu swap. On a brand-new DB menu_categories is still empty
-- (seed has not run), so this block is a no-op and seedIfEmpty still fires.
UPDATE menu_item_modifier_groups
SET item_id = item_id
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

DELETE FROM menu_item_modifier_groups
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

UPDATE menu_items SET active = 0, available = 0,
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

UPDATE menu_categories SET active = 0
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

DELETE FROM menu_items
WHERE (id LIKE 'itm-ff-%' OR id LIKE 'itm-sa-%' OR id LIKE 'itm-sl-%' OR id LIKE 'itm-ty-%'
   OR id LIKE 'itm-et-%' OR id LIKE 'itm-qn-%' OR id LIKE 'itm-sm-%' OR id LIKE 'itm-im-%'
   OR id LIKE 'itm-my-%' OR id LIKE 'itm-mz-%' OR id LIKE 'itm-si-%' OR id LIKE 'itm-ii-%'
   OR id LIKE 'itm-al-%' OR id LIKE 'itm-pv-%' OR id LIKE 'itm-ql-%')
  AND EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

DELETE FROM menu_categories
WHERE id IN (
  'cat-ff','cat-salads-m','cat-chicken','cat-meat','cat-sides','cat-cold-mezze',
  'cat-hot-mezze','cat-fruit','cat-mezze','cat-cold-m','cat-hot-m','cat-alcohol',
  'cat-beer','cat-hookah'
)
AND EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

-- Free SKUs that the new catalogue will claim (Maison salads used SL-01..04).
UPDATE menu_items SET sku = 'archived-' || id
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters')
  AND (
    sku GLOB 'FF-*' OR sku GLOB 'SA-*' OR sku GLOB 'SL-*' OR sku GLOB 'TY-*' OR
    sku GLOB 'ET-*' OR sku GLOB 'QN-*' OR sku GLOB 'SM-*' OR sku GLOB 'IM-*' OR
    sku GLOB 'MY-*' OR sku GLOB 'MZ-*' OR sku GLOB 'SI-*' OR sku GLOB 'II-*' OR
    sku GLOB 'AL-*' OR sku GLOB 'PV-*' OR sku GLOB 'QL-*'
  );

INSERT INTO menu_categories (id, name_az, name_tr, name_en, icon, accent, image, sort_order, active)
SELECT * FROM (
${cats
  .map(
    ([id, az, tr, en, icon, accent, order], i) =>
      `  SELECT '${id}' AS id, '${esc(az)}' AS name_az, '${esc(tr)}' AS name_tr, '${esc(en)}' AS name_en, '${icon}' AS icon, '${accent}' AS accent, '' AS image, ${order} AS sort_order, 1 AS active` +
      (i + 1 < cats.length ? '\n  UNION ALL' : ''),
  )
  .join('\n')}
) AS new_cats
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

INSERT INTO menu_items
  (id, category_id, sku, name_az, name_tr, name_en, description_az, description_tr, description_en,
   price_minor, cost_minor, image, prep_minutes, station, course, allergens, calories,
   popular, sort_order, created_at, updated_at)
SELECT * FROM (
${itemRows
  .map((row, i) => {
    // row is already a parenthesised VALUES tuple — rebuild as SELECT
    const inner = row.slice(1, -1);
    return `  SELECT ${inner}` + (i + 1 < itemRows.length ? '\n  UNION ALL' : '');
  })
  .join('\n')}
) AS new_items
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

UPDATE menu_items SET created_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
                   updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE created_at = 0
  AND id LIKE 'itm-%'
  AND EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');
`;

const seedFragment = `-- ------------------------------------------------------------- categories --
${catSql}
-- ------------------------------------------------------------- menu items --
${itemSql}
`;

fs.writeFileSync(path.join(ROOT, 'database', 'migrations', '010_milioner_brand_menu.sql'), migration, 'utf8');
fs.writeFileSync(path.join(ROOT, 'scripts', '_milioner_menu_fragment.sql'), seedFragment, 'utf8');
console.log('wrote migration 010 and seed fragment,', itemRows.length, 'items');
