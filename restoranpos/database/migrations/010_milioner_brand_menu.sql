-- ============================================================================
-- 010 - Milioner brand, real menu, print defaults
--
-- Fresh installs: only settings + permission (menu comes from seed).
-- Upgrades from Maison Aurelia: deactivate old catalogue and insert Milioner.
-- ============================================================================

-- Milioner restaurant profile + print defaults
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
  SELECT 'cat-ff' AS id, 'Fast Food' AS name_az, 'Fast Food' AS name_tr, 'Fast Food' AS name_en, 'utensils' AS icon, '#E07B39' AS accent, '' AS image, 1 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-salads-m' AS id, 'Salatlar' AS name_az, 'Salatalar' AS name_tr, 'Salads' AS name_en, 'leafy-green' AS icon, '#4FA978' AS accent, '' AS image, 2 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-chicken' AS id, 'Toyuq Yeməkləri' AS name_az, 'Tavuk Yemekleri' AS name_tr, 'Chicken' AS name_en, 'utensils' AS icon, '#D9A441' AS accent, '' AS image, 3 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-meat' AS id, 'Ət Yeməkləri' AS name_az, 'Et Yemekleri' AS name_tr, 'Meat' AS name_en, 'beef' AS icon, '#C45A5A' AS accent, '' AS image, 4 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-sides' AS id, 'Qarnir' AS name_az, 'Garnitür' AS name_tr, 'Sides' AS name_en, 'wheat' AS icon, '#E5CF9B' AS accent, '' AS image, 5 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-cold-mezze' AS id, 'Soyuq Məzələr' AS name_az, 'Soğuk Mezeler' AS name_tr, 'Cold Mezze' AS name_en, 'salad' AS icon, '#6A9BC9' AS accent, '' AS image, 6 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-hot-mezze' AS id, 'İsti Məzələr' AS name_az, 'Sıcak Mezeler' AS name_tr, 'Hot Mezze' AS name_en, 'flame' AS icon, '#E07B39' AS accent, '' AS image, 7 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-fruit' AS id, 'Meyvə' AS name_az, 'Meyve' AS name_tr, 'Fruit' AS name_en, 'apple' AS icon, '#52C08A' AS accent, '' AS image, 8 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-mezze' AS id, 'Məzələr' AS name_az, 'Mezeler' AS name_tr, 'Mezze' AS name_en, 'utensils' AS icon, '#C9A86A' AS accent, '' AS image, 9 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-cold-m' AS id, 'Soyuq İçkilər' AS name_az, 'Soğuk İçecekler' AS name_tr, 'Cold Drinks' AS name_en, 'cup-soda' AS icon, '#52C08A' AS accent, '' AS image, 10 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-hot-m' AS id, 'İsti İçkilər' AS name_az, 'Sıcak İçecekler' AS name_tr, 'Hot Drinks' AS name_en, 'coffee' AS icon, '#8A744A' AS accent, '' AS image, 11 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-alcohol' AS id, 'Alkoqollu İçkilər' AS name_az, 'Alkollü İçecekler' AS name_tr, 'Alcohol' AS name_en, 'wine' AS icon, '#B07FC7' AS accent, '' AS image, 12 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-beer' AS id, 'Pivələr' AS name_az, 'Bira' AS name_tr, 'Beer' AS name_en, 'beer' AS icon, '#D9A441' AS accent, '' AS image, 13 AS sort_order, 1 AS active
  UNION ALL
  SELECT 'cat-hookah' AS id, 'Qəlyan' AS name_az, 'Nargile' AS name_tr, 'Hookah' AS name_en, 'flame' AS icon, '#8A744A' AS accent, '' AS image, 14 AS sort_order, 1 AS active
) AS new_cats
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

INSERT INTO menu_items
  (id, category_id, sku, name_az, name_tr, name_en, description_az, description_tr, description_en,
   price_minor, cost_minor, image, prep_minutes, station, course, allergens, calories,
   popular, sort_order, created_at, updated_at)
SELECT * FROM (
  SELECT 'itm-ff-01','cat-ff','FF-01','Club Sandwich','Club Sandwich','Club Sandwich','','','',900,0,'',10,'kitchen','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-ff-02','cat-ff','FF-02','Burger Ət','Burger Ət','Burger Ət','','','',900,0,'',10,'kitchen','main','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-ff-03','cat-ff','FF-03','Burger Toyuq','Burger Toyuq','Burger Toyuq','','','',700,0,'',10,'kitchen','main','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-ff-04','cat-ff','FF-04','Nuggets','Nuggets','Nuggets','','','',700,0,'',10,'kitchen','main','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-ff-05','cat-ff','FF-05','Şaurma','Şaurma','Şaurma','','','',700,0,'',10,'kitchen','main','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-ff-06','cat-ff','FF-06','Hotdog','Hotdog','Hotdog','','','',400,0,'',10,'kitchen','main','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-sa-01','cat-salads-m','SA-01','Sezar Salatı','Sezar Salatı','Sezar Salatı','','','',800,0,'',10,'cold','starter','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-sa-02','cat-salads-m','SA-02','Xırt-xırt Badımcan','Xırt-xırt Badımcan','Xırt-xırt Badımcan','','','',500,0,'',10,'cold','starter','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-sa-03','cat-salads-m','SA-03','Çoban Salatı','Çoban Salatı','Çoban Salatı','','','',400,0,'',10,'cold','starter','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-sa-04','cat-salads-m','SA-04','Pomidor Salatı','Pomidor Salatı','Pomidor Salatı','','','',400,0,'',10,'cold','starter','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-ty-01','cat-chicken','TY-01','Toyuq Langet','Toyuq Langet','Toyuq Langet','','','',500,0,'',10,'kitchen','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-ty-02','cat-chicken','TY-02','Toyuq Qulyaj','Toyuq Qulyaj','Toyuq Qulyaj','','','',700,0,'',10,'kitchen','main','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-ty-03','cat-chicken','TY-03','Tabaka Broiler','Tabaka Broiler','Tabaka Broiler','','','',2000,0,'',10,'kitchen','main','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-ty-04','cat-chicken','TY-04','Tabaka Çolpa','Tabaka Çolpa','Tabaka Çolpa','','','',2200,0,'',10,'kitchen','main','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-ty-05','cat-chicken','TY-05','Çolpa Çığırtma','Çolpa Çığırtma','Çolpa Çığırtma','','','',2000,0,'',10,'kitchen','main','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-ty-06','cat-chicken','TY-06','Çolpa Limon Sousla','Çolpa Limon Sousla','Çolpa Limon Sousla','','','',1300,0,'',10,'kitchen','main','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-ty-07','cat-chicken','TY-07','Fajitos Toyuq','Fajitos Toyuq','Fajitos Toyuq','','','',900,0,'',10,'kitchen','main','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-ty-08','cat-chicken','TY-08','Qaymaqlı Toyuq','Qaymaqlı Toyuq','Qaymaqlı Toyuq','','','',800,0,'',10,'kitchen','main','[]',NULL,0,8,0,0
  UNION ALL
  SELECT 'itm-ty-09','cat-chicken','TY-09','Şabalıdlı Çolpa','Şabalıdlı Çolpa','Şabalıdlı Çolpa','','','',2000,0,'',10,'kitchen','main','[]',NULL,0,9,0,0
  UNION ALL
  SELECT 'itm-ty-10','cat-chicken','TY-10','Kiyev Kotleti','Kiyev Kotleti','Kiyev Kotleti','','','',700,0,'',10,'kitchen','main','[]',NULL,0,10,0,0
  UNION ALL
  SELECT 'itm-ty-11','cat-chicken','TY-11','Toyuq Sote','Toyuq Sote','Toyuq Sote','','','',800,0,'',10,'kitchen','main','[]',NULL,0,11,0,0
  UNION ALL
  SELECT 'itm-et-01','cat-meat','ET-01','Monastr Sayağı Ət','Monastr Sayağı Ət','Monastr Sayağı Ət','','','',1200,0,'',10,'kitchen','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-et-02','cat-meat','ET-02','Ət Langeti','Ət Langeti','Ət Langeti','','','',900,0,'',10,'kitchen','main','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-et-03','cat-meat','ET-03','Qaymaqlı Can Əti','Qaymaqlı Can Əti','Qaymaqlı Can Əti','','','',1200,0,'',10,'kitchen','main','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-et-04','cat-meat','ET-04','Alballı Can Əti','Alballı Can Əti','Alballı Can Əti','','','',1200,0,'',10,'kitchen','main','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-et-05','cat-meat','ET-05','Can Əti Qovurma','Can Əti Qovurma','Can Əti Qovurma','','','',1200,0,'',10,'kitchen','main','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-et-06','cat-meat','ET-06','Ət Sote','Ət Sote','Ət Sote','','','',1200,0,'',10,'kitchen','main','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-qn-01','cat-sides','QN-01','Düyü','Düyü','Düyü','','','',300,0,'',10,'kitchen','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-qn-02','cat-sides','QN-02','Qarabaşaq','Qarabaşaq','Qarabaşaq','','','',300,0,'',10,'kitchen','main','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-qn-03','cat-sides','QN-03','Spagetti','Spagetti','Spagetti','','','',300,0,'',10,'kitchen','main','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-qn-04','cat-sides','QN-04','Kartof Fri','Kartof Fri','Kartof Fri','','','',300,0,'',10,'kitchen','main','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-qn-05','cat-sides','QN-05','Kartof Ev Sayağı','Kartof Ev Sayağı','Kartof Ev Sayağı','','','',350,0,'',10,'kitchen','main','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-qn-06','cat-sides','QN-06','Soyutma Kartof','Soyutma Kartof','Soyutma Kartof','','','',250,0,'',10,'kitchen','main','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-sm-01','cat-cold-mezze','SM-01','Pendir','Pendir','Pendir','','','',300,0,'',10,'cold','starter','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-sm-02','cat-cold-mezze','SM-02','Turşu','Turşu','Turşu','','','',300,0,'',10,'cold','starter','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-sm-03','cat-cold-mezze','SM-03','Süzmə','Süzmə','Süzmə','','','',250,0,'',10,'cold','starter','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-sm-04','cat-cold-mezze','SM-04','Acika','Acika','Acika','','','',200,0,'',10,'cold','starter','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-sm-05','cat-cold-mezze','SM-05','Qatıq','Qatıq','Qatıq','','','',100,0,'',10,'cold','starter','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-sm-06','cat-cold-mezze','SM-06','Yaşıl Zeytun','Yaşıl Zeytun','Yaşıl Zeytun','','','',300,0,'',10,'cold','starter','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-sm-07','cat-cold-mezze','SM-07','Təzə Salat','Təzə Salat','Təzə Salat','','','',300,0,'',10,'cold','starter','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-sm-08','cat-cold-mezze','SM-08','Göyərti','Göyərti','Göyərti','','','',200,0,'',10,'cold','starter','[]',NULL,0,8,0,0
  UNION ALL
  SELECT 'itm-sm-09','cat-cold-mezze','SM-09','Limon','Limon','Limon','','','',100,0,'',10,'cold','starter','[]',NULL,0,9,0,0
  UNION ALL
  SELECT 'itm-im-01','cat-hot-mezze','IM-01','Yumurta Pomidor Pendirli','Yumurta Pomidor Pendirli','Yumurta Pomidor Pendirli','','','',500,0,'',10,'kitchen','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-im-02','cat-hot-mezze','IM-02','Yumurta Pomidor','Yumurta Pomidor','Yumurta Pomidor','','','',400,0,'',10,'kitchen','main','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-im-03','cat-hot-mezze','IM-03','Sordelka Gürcü','Sordelka Gürcü','Sordelka Gürcü','','','',500,0,'',10,'kitchen','main','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-im-04','cat-hot-mezze','IM-04','İveriya Sosiska Gürcü','İveriya Sosiska Gürcü','İveriya Sosiska Gürcü','','','',500,0,'',10,'kitchen','main','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-im-05','cat-hot-mezze','IM-05','Krakov Kolbosa Pomidorlu Pendirli','Krakov Kolbosa Pomidorlu Pendirli','Krakov Kolbosa Pomidorlu Pendirli','','','',700,0,'',10,'kitchen','main','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-im-06','cat-hot-mezze','IM-06','Selyodka Kartof ilə','Selyodka Kartof ilə','Selyodka Kartof ilə','','','',700,0,'',10,'kitchen','main','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-im-07','cat-hot-mezze','IM-07','Sosiska Manqal','Sosiska Manqal','Sosiska Manqal','','','',500,0,'',10,'kitchen','main','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-my-01','cat-fruit','MY-01','Meyvə Assorti','Meyvə Assorti','Meyvə Assorti','','','',1500,0,'',10,'cold','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-mz-01','cat-mezze','MZ-01','Saçaq Pendir Sadə','Saçaq Pendir Sadə','Saçaq Pendir Sadə','','','',350,0,'',10,'kitchen','main','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-mz-02','cat-mezze','MZ-02','Saçaq Pendir Qızartma','Saçaq Pendir Qızartma','Saçaq Pendir Qızartma','','','',400,0,'',10,'kitchen','main','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-mz-03','cat-mezze','MZ-03','Noxud','Noxud','Noxud','','','',250,0,'',10,'kitchen','main','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-mz-04','cat-mezze','MZ-04','Noxud Qızartma','Noxud Qızartma','Noxud Qızartma','','','',300,0,'',10,'kitchen','main','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-mz-05','cat-mezze','MZ-05','Püstə','Püstə','Püstə','','','',700,0,'',10,'kitchen','main','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-mz-06','cat-mezze','MZ-06','Suxari','Suxari','Suxari','','','',200,0,'',10,'kitchen','main','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-mz-07','cat-mezze','MZ-07','Çips','Çips','Çips','','','',300,0,'',10,'kitchen','main','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-mz-08','cat-mezze','MZ-08','Fimi Pendirli','Fimi Pendirli','Fimi Pendirli','','','',500,0,'',10,'kitchen','main','[]',NULL,0,8,0,0
  UNION ALL
  SELECT 'itm-mz-09','cat-mezze','MZ-09','Düşbərə Qızartma','Düşbərə Qızartma','Düşbərə Qızartma','','','',400,0,'',10,'kitchen','main','[]',NULL,0,9,0,0
  UNION ALL
  SELECT 'itm-mz-10','cat-mezze','MZ-10','Patanə Qızartma','Patanə Qızartma','Patanə Qızartma','','','',450,0,'',10,'kitchen','main','[]',NULL,0,10,0,0
  UNION ALL
  SELECT 'itm-mz-11','cat-mezze','MZ-11','Patanə Souslu Qızartma','Patanə Souslu Qızartma','Patanə Souslu Qızartma','','','',550,0,'',10,'kitchen','main','[]',NULL,0,11,0,0
  UNION ALL
  SELECT 'itm-mz-12','cat-mezze','MZ-12','Boğaz Qızartma','Boğaz Qızartma','Boğaz Qızartma','','','',400,0,'',10,'kitchen','main','[]',NULL,0,12,0,0
  UNION ALL
  SELECT 'itm-mz-13','cat-mezze','MZ-13','Boğaz Hisə Verilmiş','Boğaz Hisə Verilmiş','Boğaz Hisə Verilmiş','','','',400,0,'',10,'kitchen','main','[]',NULL,0,13,0,0
  UNION ALL
  SELECT 'itm-mz-14','cat-mezze','MZ-14','Boğaz Qızartma Sousda','Boğaz Qızartma Sousda','Boğaz Qızartma Sousda','','','',450,0,'',10,'kitchen','main','[]',NULL,0,14,0,0
  UNION ALL
  SELECT 'itm-mz-15','cat-mezze','MZ-15','Göbələk Papaqları Pendirli','Göbələk Papaqları Pendirli','Göbələk Papaqları Pendirli','','','',500,0,'',10,'kitchen','main','[]',NULL,0,15,0,0
  UNION ALL
  SELECT 'itm-mz-16','cat-mezze','MZ-16','Göbələk Suxaridə','Göbələk Suxaridə','Göbələk Suxaridə','','','',600,0,'',10,'kitchen','main','[]',NULL,0,16,0,0
  UNION ALL
  SELECT 'itm-mz-17','cat-mezze','MZ-17','Qrenki Sadə','Qrenki Sadə','Qrenki Sadə','','','',400,0,'',10,'kitchen','main','[]',NULL,0,17,0,0
  UNION ALL
  SELECT 'itm-mz-18','cat-mezze','MZ-18','Qrenki Pendirli','Qrenki Pendirli','Qrenki Pendirli','','','',500,0,'',10,'kitchen','main','[]',NULL,0,18,0,0
  UNION ALL
  SELECT 'itm-mz-19','cat-mezze','MZ-19','Toyuq Qanadları Bufalo','Toyuq Qanadları Bufalo','Toyuq Qanadları Bufalo','','','',700,0,'',10,'kitchen','main','[]',NULL,0,19,0,0
  UNION ALL
  SELECT 'itm-mz-20','cat-mezze','MZ-20','Toyuq Qanadları Suxaridə','Toyuq Qanadları Suxaridə','Toyuq Qanadları Suxaridə','','','',600,0,'',10,'kitchen','main','[]',NULL,0,20,0,0
  UNION ALL
  SELECT 'itm-mz-21','cat-mezze','MZ-21','Hamsi Balıq Suxaridə','Hamsi Balıq Suxaridə','Hamsi Balıq Suxaridə','','','',500,0,'',10,'kitchen','main','[]',NULL,0,21,0,0
  UNION ALL
  SELECT 'itm-mz-22','cat-mezze','MZ-22','Krivetka Dəniz','Krivetka Dəniz','Krivetka Dəniz','','','',1000,0,'',10,'kitchen','main','[]',NULL,0,22,0,0
  UNION ALL
  SELECT 'itm-mz-23','cat-mezze','MZ-23','Krivetka Çay','Krivetka Çay','Krivetka Çay','','','',1000,0,'',10,'kitchen','main','[]',NULL,0,23,0,0
  UNION ALL
  SELECT 'itm-mz-24','cat-mezze','MZ-24','Pendirli Kartof Fri','Pendirli Kartof Fri','Pendirli Kartof Fri','','','',500,0,'',10,'kitchen','main','[]',NULL,0,24,0,0
  UNION ALL
  SELECT 'itm-mz-25','cat-mezze','MZ-25','Göbələk Çips','Göbələk Çips','Göbələk Çips','','','',500,0,'',10,'kitchen','main','[]',NULL,0,25,0,0
  UNION ALL
  SELECT 'itm-mz-26','cat-mezze','MZ-26','Pendir Çubuqları','Pendir Çubuqları','Pendir Çubuqları','','','',500,0,'',10,'kitchen','main','[]',NULL,0,26,0,0
  UNION ALL
  SELECT 'itm-mz-27','cat-mezze','MZ-27','Gürcü Qızartma','Gürcü Qızartma','Gürcü Qızartma','','','',120,0,'',10,'kitchen','main','[]',NULL,0,27,0,0
  UNION ALL
  SELECT 'itm-mz-28','cat-mezze','MZ-28','Gürzə Qızartma','Gürzə Qızartma','Gürzə Qızartma','','','',500,0,'',10,'kitchen','main','[]',NULL,0,28,0,0
  UNION ALL
  SELECT 'itm-mz-29','cat-mezze','MZ-29','Toyuq Çips','Toyuq Çips','Toyuq Çips','','','',600,0,'',10,'kitchen','main','[]',NULL,0,29,0,0
  UNION ALL
  SELECT 'itm-mz-30','cat-mezze','MZ-30','Toyuq Popcorn','Toyuq Popcorn','Toyuq Popcorn','','','',500,0,'',10,'kitchen','main','[]',NULL,0,30,0,0
  UNION ALL
  SELECT 'itm-mz-31','cat-mezze','MZ-31','Bildirçin','Bildirçin','Bildirçin','','','',400,0,'',10,'kitchen','main','[]',NULL,0,31,0,0
  UNION ALL
  SELECT 'itm-si-01','cat-cold-m','SI-01','Coca-Cola (Banka)','Coca-Cola (Banka)','Coca-Cola (Banka)','','','',300,0,'',10,'bar','drinks','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-si-02','cat-cold-m','SI-02','Fuse Tea (Banka)','Fuse Tea (Banka)','Fuse Tea (Banka)','','','',300,0,'',10,'bar','drinks','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-si-03','cat-cold-m','SI-03','Hell','Hell','Hell','','','',250,0,'',10,'bar','drinks','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-si-04','cat-cold-m','SI-04','Bizon','Bizon','Bizon','','','',200,0,'',10,'bar','drinks','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-si-05','cat-cold-m','SI-05','Sirab Qazlı (Şüşə)','Sirab Qazlı (Şüşə)','Sirab Qazlı (Şüşə)','','','',250,0,'',10,'bar','drinks','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-si-06','cat-cold-m','SI-06','Sirab Qazsız (Şüşə)','Sirab Qazsız (Şüşə)','Sirab Qazsız (Şüşə)','','','',250,0,'',10,'bar','drinks','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-si-07','cat-cold-m','SI-07','Sarıkız','Sarıkız','Sarıkız','','','',200,0,'',10,'bar','drinks','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-si-08','cat-cold-m','SI-08','Power','Power','Power','','','',200,0,'',10,'bar','drinks','[]',NULL,0,8,0,0
  UNION ALL
  SELECT 'itm-si-09','cat-cold-m','SI-09','Meyvə Şirəsi','Meyvə Şirəsi','Meyvə Şirəsi','','','',400,0,'',10,'bar','drinks','[]',NULL,0,9,0,0
  UNION ALL
  SELECT 'itm-si-10','cat-cold-m','SI-10','Limonat (1L)','Limonat (1L)','Limonat (1L)','','','',300,0,'',10,'bar','drinks','[]',NULL,0,10,0,0
  UNION ALL
  SELECT 'itm-si-11','cat-cold-m','SI-11','Ayran (Bakal)','Ayran (Bakal)','Ayran (Bakal)','','','',150,0,'',10,'bar','drinks','[]',NULL,0,11,0,0
  UNION ALL
  SELECT 'itm-ii-01','cat-hot-m','II-01','Çay Şokolad','Çay Şokolad','Çay Şokolad','','','',800,0,'',10,'bar','drinks','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-ii-02','cat-hot-m','II-02','Çay Mürəbbə (kiçik)','Çay Mürəbbə (kiçik)','Çay Mürəbbə (kiçik)','','','',1000,0,'',10,'bar','drinks','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-ii-03','cat-hot-m','II-03','Çay Mürəbbə (böyük)','Çay Mürəbbə (böyük)','Çay Mürəbbə (böyük)','','','',1200,0,'',10,'bar','drinks','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-ii-04','cat-hot-m','II-04','Çay Popkek','Çay Popkek','Çay Popkek','','','',900,0,'',10,'bar','drinks','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-ii-05','cat-hot-m','II-05','Çay Paxlava','Çay Paxlava','Çay Paxlava','','','',1200,0,'',10,'bar','drinks','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-ii-06','cat-hot-m','II-06','Çay Snickers','Çay Snickers','Çay Snickers','','','',800,0,'',10,'bar','drinks','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-ii-07','cat-hot-m','II-07','Çay Rulet','Çay Rulet','Çay Rulet','','','',800,0,'',10,'bar','drinks','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-ii-08','cat-hot-m','II-08','Çay Çərəz','Çay Çərəz','Çay Çərəz','','','',1200,0,'',10,'bar','drinks','[]',NULL,0,8,0,0
  UNION ALL
  SELECT 'itm-ii-09','cat-hot-m','II-09','Çay Dəstgahı','Çay Dəstgahı','Çay Dəstgahı','','','',3000,0,'',10,'bar','drinks','[]',NULL,0,9,0,0
  UNION ALL
  SELECT 'itm-ii-10','cat-hot-m','II-10','Çay Dəstgahı (Qəlyan ilə)','Çay Dəstgahı (Qəlyan ilə)','Çay Dəstgahı (Qəlyan ilə)','','','',3800,0,'',10,'bar','drinks','[]',NULL,0,10,0,0
  UNION ALL
  SELECT 'itm-ii-11','cat-hot-m','II-11','Kofe','Kofe','Kofe','','','',200,0,'',10,'bar','drinks','[]',NULL,0,11,0,0
  UNION ALL
  SELECT 'itm-ii-12','cat-hot-m','II-12','Cappuccino','Cappuccino','Cappuccino','','','',250,0,'',10,'bar','drinks','[]',NULL,0,12,0,0
  UNION ALL
  SELECT 'itm-al-01','cat-alcohol','AL-01','Viski (Jameson)','Viski (Jameson)','Viski (Jameson)','','','',600,0,'',10,'bar','drinks','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-al-02','cat-alcohol','AL-02','Chivas','Chivas','Chivas','','','',700,0,'',10,'bar','drinks','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-al-03','cat-alcohol','AL-03','Tekila (Olmeca)','Tekila (Olmeca)','Tekila (Olmeca)','','','',600,0,'',10,'bar','drinks','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-pv-01','cat-beer','PV-01','NZS','NZS','NZS','','','',150,0,'',10,'bar','drinks','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-pv-02','cat-beer','PV-02','Xırdalan','Xırdalan','Xırdalan','','','',300,0,'',10,'bar','drinks','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-pv-03','cat-beer','PV-03','Xırdalan Non Filter','Xırdalan Non Filter','Xırdalan Non Filter','','','',350,0,'',10,'bar','drinks','[]',NULL,0,3,0,0
  UNION ALL
  SELECT 'itm-pv-04','cat-beer','PV-04','Efes Zero','Efes Zero','Efes Zero','','','',400,0,'',10,'bar','drinks','[]',NULL,0,4,0,0
  UNION ALL
  SELECT 'itm-pv-05','cat-beer','PV-05','Efes Draft','Efes Draft','Efes Draft','','','',700,0,'',10,'bar','drinks','[]',NULL,0,5,0,0
  UNION ALL
  SELECT 'itm-pv-06','cat-beer','PV-06','Baltika','Baltika','Baltika','','','',400,0,'',10,'bar','drinks','[]',NULL,0,6,0,0
  UNION ALL
  SELECT 'itm-pv-07','cat-beer','PV-07','Heineken','Heineken','Heineken','','','',800,0,'',10,'bar','drinks','[]',NULL,0,7,0,0
  UNION ALL
  SELECT 'itm-pv-08','cat-beer','PV-08','Jägermeister','Jägermeister','Jägermeister','','','',700,0,'',10,'bar','drinks','[]',NULL,0,8,0,0
  UNION ALL
  SELECT 'itm-ql-01','cat-hookah','QL-01','Saxsıda','Saxsıda','Saxsıda','','','',1500,0,'',10,'bar','drinks','[]',NULL,0,1,0,0
  UNION ALL
  SELECT 'itm-ql-02','cat-hookah','QL-02','Qreyfurt','Qreyfurt','Qreyfurt','','','',2000,0,'',10,'bar','drinks','[]',NULL,0,2,0,0
  UNION ALL
  SELECT 'itm-ql-03','cat-hookah','QL-03','Ananas','Ananas','Ananas','','','',2500,0,'',10,'bar','drinks','[]',NULL,0,3,0,0
) AS new_items
WHERE EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');

UPDATE menu_items SET created_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
                   updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE created_at = 0
  AND id LIKE 'itm-%'
  AND EXISTS (SELECT 1 FROM menu_categories WHERE id = 'cat-starters');
