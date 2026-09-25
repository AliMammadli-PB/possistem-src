-- Default control API: possistem.az.
-- Applied automatically by the C++ migrator on next app start (no manual step).
-- Rewrites legacy offlinegame / old IP URLs; fresh installs get possistem.az by default.

UPDATE app_settings
SET value = 'https://possistem.az/pos/api',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'license.controlUrl'
  AND (
    value IN (
      'https://offlinegame.az/pos/api',
      'http://offlinegame.az/pos/api',
      'https://217.179.126.94/pos/api',
      'http://217.179.126.94/pos/api'
    )
    OR value LIKE '%offlinegame.az%'
  );

INSERT INTO app_settings (key, value, value_type, updated_at)
SELECT 'license.controlUrl', 'https://possistem.az/pos/api', 'string',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'license.controlUrl');
