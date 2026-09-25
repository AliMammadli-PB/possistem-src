-- ============================================================================
-- 013 - Denser 80mm receipt columns (compact thermal look)
-- ============================================================================

INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('printer.charsPerLine80', '48', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.charsPerLine58', '32', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.renderMode', 'raster', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  value_type = excluded.value_type,
  updated_at = excluded.updated_at;
