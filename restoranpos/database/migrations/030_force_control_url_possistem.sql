-- Force every till onto the live control API (possistem.az).
-- Covers offlinegame leftovers, trailing slashes, and http→https drift.
-- Safe to re-run: only rewrites known-legacy values.

UPDATE app_settings
SET value = 'https://possistem.az/pos/api',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'license.controlUrl'
  AND (
    value LIKE '%offlinegame.az%'
    OR value LIKE '%217.179.126.94%'
    OR value LIKE '%cyberplus.az%'
    OR value LIKE 'http://possistem.az/%'
  );

INSERT INTO app_settings (key, value, value_type, updated_at)
SELECT 'license.controlUrl', 'https://possistem.az/pos/api', 'string',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'license.controlUrl');
