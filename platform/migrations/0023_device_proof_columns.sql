-- 0020 - Device proof columns used by signed Market POS heartbeats.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS device_public_key text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_nonce text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_signed_at timestamptz;

-- Guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS, and a bare ADD makes
-- the migration impossible to re-run against a database that already has it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_public_key_hex_chk') THEN
    ALTER TABLE devices
      DROP CONSTRAINT IF EXISTS devices_public_key_hex_chk,
      ADD CONSTRAINT devices_public_key_hex_chk
      CHECK (device_public_key IS NULL OR device_public_key ~ '^[0-9a-fA-F]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS devices_public_key_uidx
  ON devices (device_public_key)
  WHERE device_public_key IS NOT NULL;
