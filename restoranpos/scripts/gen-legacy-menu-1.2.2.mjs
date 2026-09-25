/** Generate migration 020 from the photographed legacy Milioner menu. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'database', 'migrations', '020_legacy_menu_drafts.sql');
const SEED_OUT = path.join(ROOT, 'database', 'seed', '002_legacy_menu_drafts.sql');

const groups = [
  ['cat-extras', 'bar', 'drinks', [
    'Acı bibər', 'Alça', 'Alma', 'Ayran (Bokal)', 'Badam', 'Barbekü sous', 'Bulyon',
    'Cərəz', 'Çörək Təndir', 'Çörək Zavod', 'Fındıq', 'Füjer', 'Gavalı', 'Kərə yağı',
    'Kivi', 'Kök limon suyunda', 'Lavaş', 'Mandarin', 'Marojna', 'Nar', 'Pivə bokalı',
    'Pomidor', 'Portağal', 'Pul bibər', 'Qara çörək', 'Qatıq', 'Qırmızı soğan', 'Qoz ləpə',
  ]],
  ['cat-beer', 'bar', 'drinks', [
    'Baltika (0)', 'Efes (Draft)', 'Efes (Zero)', 'NZS (Bokal)', 'NZS (Füjer)', 'Tuborg',
    'Xırdalan', 'Xırdalan (0)', 'Xırdalan Non Filter (Bokal)', 'Xırdalan Non Filter (Füjer)',
    'Xırdalan Sadə (Bokal)', 'Xırdalan Sadə (Füjer)',
  ]],
  ['cat-ff', 'kitchen', 'main', [
    'Club Sandwich', 'Corey Arası Sosis', 'Corey Arası Sosis + Fri', 'Dürüm Sosis', 'Fri',
    'Meksikan Naços', 'Naggets', 'Naggets + Fri', 'Şaurma', 'Şaurma (Milioner)', 'Şaurma + Fri',
  ]],
  ['cat-meat', 'kitchen', 'main', [
    'Can əti albalı', 'Can əti langet', 'Can əti nar qovurma', 'Can əti qovurma',
    'Ət Langet', 'Ət Qulyas', 'Faxitos', 'Kotlet', 'Kotlet + Yumurta', 'Monastır sayağı ət',
    'Nar qovurma', 'Qaymaqlı can əti', 'Qiymə ət bibərli', 'Qiymə ət', 'Quzu qovurma',
    'Saç (Quzu)', 'Saç Can Əti', 'Sireli Dana', 'Stroqanov', 'Tusonka + Kartof',
  ]],
  ['cat-fish', 'kitchen', 'main', [
    'Dorado', 'Forel', 'Forel hisə verilmiş', 'Forel qızartma', 'Selyodka',
    'Selyodka + Kartof', 'Skumbriya',
  ]],
  ['cat-hot-m', 'bar', 'drinks', [
    'Caska Çay', 'Çay', 'Çay Dəsgah', 'Çay Gavalı', 'Çay + Quru meyvə', 'Çay + Cərəz',
    'Çay + Kişmiş', 'Çay + Mürəbbə (10)', 'Çay + Mürəbbə (12)', 'Çay + Paxlava',
    'Çay + Plitka', 'Çay + Popkek', 'Çay + Pryanik', 'Çay + Snickers', 'Çay + Şokolad',
    'Çay + Toffi', 'Çay + Xurma', 'Ətirli çay', 'Kapuçino', 'Kişmiş', 'Kofe',
    'Mürəbbə (7)', 'Mürəbbə (9)', 'Popkek', 'Pryanik', 'Quru meyvə + Çay', 'Samovar', 'Şokolad',
  ]],
  ['cat-mezze', 'kitchen', 'starter', [
    'Araxıs', 'Badımcan Cipsi', 'Basdırma Ət', 'Bildirçin', 'Boğaz Hisə Verilmiş',
    'Boğaz Qızartma', 'Boğaz Qızartma Barbekü Souslu', 'Boğaz Turşulu', 'Cipsi',
    'Düşbərə Qızartma', 'Fimi Assorti', 'Göbələk Cipsi', 'Göbələk Papaqları Pendirli',
    'Göbələk Popkorn', 'Gürzə', 'Hamsi Qızartma', 'Kanapə', 'Krivetka (Dəniz-Çay)',
    'Krivetka Tempura', 'Lavaş Cipsi', 'Naços', 'Noxud', 'Noxud Edviyyatlı',
    'Noxud Qızartma', 'Pendir Çubuqları', 'Pendirli Fri', 'Pətənək Qızartma',
    'Pətənək (Barbekü Souslu)', 'Pətənək Turşulu', 'Püstə', 'Qrenki Pendirli',
    'Qutab (mini)', 'Saçaq Pendir (Ədviyyatlı)', 'Saçaq Pendir Qızartma',
    'Saçaq Pendir Sadə', 'Suxari', 'Suxari Obertos', 'Toyuq Chersi', 'Toyuq Cipsi',
    'Toyuq Halqaları', 'Toyuq Popkorn', 'Toyuq Qanadları Buffalo',
    'Toyuq Qanadları Suxaridə', 'Tum (Ağ)', 'Tum (Qara)', 'Xəngəl Qızartma',
    'Xırt-xırt Sosis',
  ]],
  ['cat-hot-mezze', 'kitchen', 'starter', [
    'İveriya', 'Kartof ev sayağı yumurta', 'Krakov kolbasa pendirli', 'Pomidor yumurta',
    'Pomidor yumurta pendirli', 'Qayğanaq (yumurta)', 'Sardelka (Gürcü)',
    'Selyodka kartof', 'Sosiska manqal', 'Sosiska + Yumurta',
  ]],
  ['cat-sides', 'kitchen', 'main', [
    'Düyü', 'Düyü + Langet', 'Kartof Ev Sayağı', 'Püre', 'Püre Yumurtalı', 'Qreçka',
    'Soyutma Kartof', 'Spagetti', 'Spagetti Pendirli',
  ]],
  ['cat-hookah', 'bar', 'drinks', [
    'Qəlyan Caskada', 'Qəlyan Caskada Premium', 'Qəlyan Endirimli', 'Qəlyan Qreyfrutda',
  ]],
];

const esc = (value) => value.replaceAll("'", "''");
let index = 0;
const rows = groups.flatMap(([categoryId, station, course, names]) =>
  names.map((name, sort) => {
    index += 1;
    return `  ('itm-legacy-${String(index).padStart(3, '0')}','${categoryId}','LEG-${String(index).padStart(3, '0')}','${esc(name)}','${esc(name)}','${esc(name)}','${station}','${course}',${sort + 1})`;
  }),
);

const header = `-- Products transcribed from the photographed legacy menu.
-- Prices were not supplied reliably, therefore every new row is an unpublished
-- draft. Admin may add a picture/price and publish it without affecting the
-- existing 118-item operational menu.
`;
const categorySeed = `INSERT INTO menu_categories
  (id,name_az,name_tr,name_en,icon,accent,image,sort_order,active)
VALUES
  ('cat-extras','Əlavələr','Ekstralar','Extras','plus','#C9A86A','',15,1),
  ('cat-fish','Balıq Yeməkləri','Balık Yemekleri','Fish','fish','#6A9BC9','',16,1)
ON CONFLICT(id) DO UPDATE SET active=1;
`;
const categoryMigration = `INSERT INTO menu_categories
  (id,name_az,name_tr,name_en,icon,accent,image,sort_order,active)
SELECT * FROM (
  SELECT 'cat-extras','Əlavələr','Ekstralar','Extras','plus','#C9A86A','',15,1
  UNION ALL
  SELECT 'cat-fish','Balıq Yeməkləri','Balık Yemekleri','Fish','fish','#6A9BC9','',16,1
) WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id='cat-ff')
ON CONFLICT(id) DO UPDATE SET active=1;
`;
const draftInsert = `
WITH legacy(id,category_id,sku,name_az,name_tr,name_en,station,course,sort_order) AS (
VALUES
${rows.join(',\n')}
)
INSERT INTO menu_items
  (id,category_id,sku,name_az,name_tr,name_en,description_az,description_tr,description_en,
   price_minor,cost_minor,image,prep_minutes,station,course,allergens,calories,popular,
   available,sold_out,sort_order,active,archived,kitchen_route,tags_json,created_at,updated_at)
SELECT l.id,l.category_id,l.sku,l.name_az,l.name_tr,l.name_en,'','','',
       0,0,'',10,l.station,l.course,'[]',NULL,0,1,0,l.sort_order,0,0,'','[]',
       CAST(strftime('%s','now') AS INTEGER)*1000,
       CAST(strftime('%s','now') AS INTEGER)*1000
FROM legacy l
WHERE EXISTS (SELECT 1 FROM menu_categories c WHERE c.id=l.category_id)
  AND NOT EXISTS (
    SELECT 1 FROM menu_items m
    WHERE m.archived=0 AND lower(trim(m.name_az))=lower(trim(l.name_az))
  );
`;

const sql = `-- 020 - photographed menu drafts for upgrades
${header}
${categoryMigration}
${draftInsert}`;
const seedSql = `-- Fresh-install companion for migration 020.
${header}
${categorySeed}
${draftInsert}`;

fs.writeFileSync(OUT, sql, 'utf8');
fs.writeFileSync(SEED_OUT, seedSql, 'utf8');
console.log(`[legacy-menu] wrote ${path.relative(ROOT, OUT)} and ${path.relative(ROOT, SEED_OUT)} with ${rows.length} photographed rows`);
/*
INSERT INTO menu_categories
  (id,name_az,name_tr,name_en,icon,accent,image,sort_order,active)
VALUES
  ('cat-extras','Əlavələr','Ekstralar','Extras','plus','#C9A86A','',15,1),
  ('cat-fish','Balıq Yeməkləri','Balık Yemekleri','Fish','fish','#6A9BC9','',16,1)
ON CONFLICT(id) DO UPDATE SET active=1;

WITH legacy(id,category_id,sku,name_az,name_tr,name_en,station,course,sort_order) AS (
VALUES
${rows.join(',\n')}
)
INSERT INTO menu_items
  (id,category_id,sku,name_az,name_tr,name_en,description_az,description_tr,description_en,
   price_minor,cost_minor,image,prep_minutes,station,course,allergens,calories,popular,
   available,sold_out,sort_order,active,archived,kitchen_route,tags_json,created_at,updated_at)
SELECT l.id,l.category_id,l.sku,l.name_az,l.name_tr,l.name_en,'','','',
       0,0,'',10,l.station,l.course,'[]',NULL,0,1,0,l.sort_order,0,0,'','[]',
       CAST(strftime('%s','now') AS INTEGER)*1000,
       CAST(strftime('%s','now') AS INTEGER)*1000
FROM legacy l
WHERE NOT EXISTS (
  SELECT 1 FROM menu_items m
  WHERE m.archived=0 AND lower(trim(m.name_az))=lower(trim(l.name_az))
);
`;
*/
