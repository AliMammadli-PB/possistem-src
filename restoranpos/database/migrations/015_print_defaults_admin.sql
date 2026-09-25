-- ============================================================================
-- 015 - Receipt defaults matching tuned UI (readable 40-col / small side margin)
-- ============================================================================

INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('printer.paperWidth', '80', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.charsPerLine80', '40', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.charsPerLine58', '28', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.fontHeightPx', '32', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.fontWidthPx', '14', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.sideMarginPx', '2', 'int', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.renderMode', 'raster', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  value_type = excluded.value_type,
  updated_at = excluded.updated_at;
