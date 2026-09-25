-- 029 - Clear stock receipt identity placeholders; leave custom values alone.
-- Fresh installs already get blanks from seed (no default halls/tables).

UPDATE app_settings
SET value = '',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.name'
  AND value IN (
    'Offline POS',
    'possistem',
    'Possistem',
    'Milioner',
    'Milioner Pub',
    'Milioner Pub & Lounge',
    'MILIONER',
    'Maison Aurelia'
  );

UPDATE app_settings
SET value = '',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.tagline'
  AND value IN (
    'Restaurant POS',
    'Restoran POS',
    'Pub & Lounge',
    'PUB & LOUNGE',
    'Restoran & Lounge'
  );

UPDATE app_settings
SET value = '',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.address'
  AND value IN (
    'Lütfizadə 98',
    'Lütfizade 98',
    'Lutfizade 98'
  );

UPDATE app_settings
SET value = '',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.phone'
  AND value IN (
    '+994505013540',
    '994505013540',
    '+994 50 501 35 40'
  );

UPDATE app_settings
SET value = '',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'restaurant.hours'
  AND (
    value IN (
      '12:00 – 02:00',
      '12:00 - 02:00',
      '12:00-02:00',
      '12:00 – 02:00'
    )
    OR replace(replace(value, '–', '-'), ' ', '') = '12:00-02:00'
  );
