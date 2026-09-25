-- Keep table identity operational and immediately readable at a distance.
-- Area names remain Zal / Bar / Kabinet; every table is numbered locally.
UPDATE restaurant_tables
SET label = 'Masa ' || CAST(sort_order AS TEXT),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE active = 1
  AND area_id IN ('area-salon', 'area-bar', 'area-vip');
