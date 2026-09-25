-- ============================================================================
-- 014 - Auto-close defaults: 40-col receipts + readable font pixels
-- ============================================================================

INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('printer.charsPerLine80', '40', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.charsPerLine58', '28', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.fontHeightPx', '28', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.fontWidthPx', '0', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.sideMarginPx', '24', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.renderMode', 'raster', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  value_type = excluded.value_type,
  updated_at = excluded.updated_at;

-- Tables stuck in "cleaning" after older builds become free again.
UPDATE restaurant_tables
SET status = 'available', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE status = 'cleaning';
