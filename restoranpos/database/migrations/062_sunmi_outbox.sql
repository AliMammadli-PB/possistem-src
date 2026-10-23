-- Immutable fiscal source documents are committed with the local sale/refund.
CREATE TABLE sunmi_outbox (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent_id TEXT,
 terminal_id TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 response_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX sunmi_outbox_pending ON sunmi_outbox(status,created_at);

ALTER TABLE payments ADD COLUMN bank_rrn TEXT;
