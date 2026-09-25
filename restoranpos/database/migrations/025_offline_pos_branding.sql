-- 025 - Rename default Milioner branding to Offline POS
-- Only rewrites stock seed/default values; custom restaurant names are left alone.

UPDATE app_settings
SET value = 'Offline POS',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.name'
  AND value IN (
    'Milioner',
    'Milioner Pub',
    'Milioner Pub & Lounge',
    'MILIONER'
  );

UPDATE app_settings
SET value = 'Restaurant POS',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.tagline'
  AND value IN ('Pub & Lounge', 'PUB & LOUNGE');
