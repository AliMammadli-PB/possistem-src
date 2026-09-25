-- 028 - Receipt branding defaults: empty restaurant name, no stock Offline/milioner label.
-- Custom restaurant names are left alone. Logo stays optional (printer.logoDataUrl).

UPDATE app_settings
SET value = '',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.name'
  AND value IN (
    'Offline POS',
    'Milioner',
    'Milioner Pub',
    'Milioner Pub & Lounge',
    'MILIONER',
    'Maison Aurelia'
  );

INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at) VALUES
  ('printer.logoDataUrl', '', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000);
