-- ============================================================================
-- 016 - USB receipt printer auto-detection
--
-- `printer.receipt` used to default to a hardcoded LAN address, and the
-- migrator rewrote that address back over any empty or `virtual` value on every
-- startup. A till with a USB printer therefore had no way to stay configured.
-- The sentinel `auto` means "find the printer when the receipt is printed",
-- which covers a device that has no spooler queue at all.
--
-- Only the untouched default is migrated: an address or queue name the operator
-- deliberately chose is left exactly as it is.
-- ============================================================================

UPDATE app_settings
   SET value = 'auto',
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE key = 'printer.receipt'
   AND value IN ('tcp:192.168.1.200:9100', 'virtual', '');

INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('printer.autoDetect', '1', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO NOTHING;

-- Written by migration 012 but never read: every code path resolves the display
-- style through `locale.currencyDisplay`.
DELETE FROM app_settings WHERE key = 'printer.currencyDisplay';
