-- ============================================================================
-- 012 - Offline POS branding + receipt print spacing
-- ============================================================================

INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('restaurant.name', 'Offline POS', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('restaurant.tagline', 'Restaurant POS', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('restaurant.phone', '+994505013540', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('restaurant.address', 'Lütfizadə 98', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('restaurant.hours', '12:00 - 02:00', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.charsPerLine80', '42', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.renderMode', 'raster', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.currencyDisplay', 'symbol', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  value_type = excluded.value_type,
  updated_at = excluded.updated_at;
