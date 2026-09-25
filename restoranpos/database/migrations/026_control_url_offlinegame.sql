-- Retired control host 217.179.126.94 is unreachable. Existing tills still
-- store it from migration 007; desktop already ignores the host, but rewrite
-- the setting so license.status / diagnostics show the live origin.

UPDATE app_settings
SET value = 'https://offlinegame.az/pos/api',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'license.controlUrl'
  AND (
    value LIKE '%217.179.126.94%'
    OR value LIKE '%cyberplus.az%'
  );
