-- Bind each activated till to its own DPAPI-protected Ed25519 private key.
-- Existing devices remain on fingerprint compatibility until they redeem again.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS heartbeat_auth_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS device_public_key text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_nonce text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_signed_at timestamptz;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the bare ADD made this
-- migration impossible to re-run: on a database where it had already been
-- applied it aborted with "constraint already exists", taking every later
-- migration down with it. Guarded so the file is idempotent like the rest.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_public_key_hex_chk') THEN
    ALTER TABLE devices
      ADD CONSTRAINT devices_public_key_hex_chk
      CHECK (device_public_key IS NULL OR device_public_key ~ '^[0-9a-fA-F]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS devices_public_key_uidx
  ON devices (device_public_key)
  WHERE device_public_key IS NOT NULL;
