-- Compatibility-preserving heartbeat authentication rollout.
--
-- Existing desktop clients may only know the device UUID. Once a client sends
-- its activation fingerprint on heartbeat, the device is permanently upgraded
-- and UUID-only heartbeats are rejected. This closes downgrade attempts without
-- immediately disconnecting installed legacy clients.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS heartbeat_auth_required BOOLEAN NOT NULL DEFAULT false;
