-- Sync resilience: dead-letter quarantine, pre-activation parking, peer cursors
-- and the index that makes the peer-filtered export actually selective.
PRAGMA foreign_keys = ON;

-- Inbound events we could not apply. Quarantined rather than retried forever, so
-- one unapplicable event cannot stall the whole replication stream.
CREATE TABLE IF NOT EXISTS sync_events_dead (
  event_id TEXT PRIMARY KEY,
  origin_device_id TEXT NOT NULL,
  origin_seq INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT ''
);

-- Events produced before sync.configure assigned this device an identity. Without
-- this they were dropped on the floor and never replicated.
CREATE TABLE IF NOT EXISTS sync_events_orphan (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Durable per-peer cursors. Previously peer progress lived only in the Electron
-- process, so a restart re-sent the entire outbox and retention could never tell
-- which events were safe to drop.
CREATE TABLE IF NOT EXISTS sync_peer_vectors (
  peer_device_id TEXT NOT NULL,
  origin_device_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(peer_device_id, origin_device_id)
);

-- The export filters on (origin_device_id, origin_seq); without this index that
-- filter degrades to a scan of the whole outbox on every 2s cycle.
CREATE INDEX IF NOT EXISTS sync_events_origin_seq_idx ON sync_events(origin_device_id, origin_seq);
CREATE INDEX IF NOT EXISTS sync_events_dead_failed_idx ON sync_events_dead(failed_at);

INSERT OR IGNORE INTO settings(key, value) VALUES ('syncRetentionDays', '30');
