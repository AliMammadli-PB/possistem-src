-- Market POS shared inventory: durable event outbox and peer vectors.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_events (
  event_id TEXT PRIMARY KEY,
  origin_device_id TEXT NOT NULL,
  origin_seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  server_acked INTEGER NOT NULL DEFAULT 0 CHECK (server_acked IN (0, 1)),
  UNIQUE(origin_device_id, origin_seq)
);

CREATE TABLE IF NOT EXISTS sync_vectors (
  origin_device_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_peers (
  device_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol_version INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_catalog_clock (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  logical_at INTEGER NOT NULL,
  origin_device_id TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS sync_events_created_idx ON sync_events(created_at);
CREATE INDEX IF NOT EXISTS sync_events_pending_idx ON sync_events(server_acked, created_at);

INSERT OR IGNORE INTO settings(key, value) VALUES ('syncDeviceId', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('syncBootstrapDone', 'false');
