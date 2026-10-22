-- Immutable cancellation evidence. The live amount becomes zero, so existing
-- debt/payroll readers cannot accidentally count a cancelled payment.
CREATE TABLE IF NOT EXISTS document_voids (
 doc_type TEXT NOT NULL, doc_id TEXT NOT NULL, before_json TEXT NOT NULL,
 original_amount_minor INTEGER NOT NULL, reason TEXT NOT NULL,
 actor_id TEXT, voided_at INTEGER NOT NULL, PRIMARY KEY(doc_type,doc_id)
);
CREATE TABLE IF NOT EXISTS transfer_docs (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
 from_warehouse_id TEXT NOT NULL, to_warehouse_id TEXT NOT NULL,
 from_device_id TEXT NOT NULL DEFAULT '', to_device_id TEXT NOT NULL DEFAULT '',
 from_name TEXT NOT NULL DEFAULT '', to_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','dispatched','received','return_pending','closed','cancelled')),
 note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
 actor_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 dispatched_at INTEGER, received_at INTEGER, returned_at INTEGER,
 source_copy INTEGER NOT NULL DEFAULT 1,
 reversal_of TEXT, correction_id TEXT
);
CREATE TABLE IF NOT EXISTS transfer_lines (
 id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfer_docs(id),
 ingredient_id TEXT NOT NULL, product_json TEXT NOT NULL,
 qty_milli INTEGER NOT NULL CHECK(qty_milli>0),
 accepted_milli INTEGER NOT NULL DEFAULT 0 CHECK(accepted_milli>=0),
 rejected_milli INTEGER NOT NULL DEFAULT 0 CHECK(rejected_milli>=0),
 rejection_reason TEXT NOT NULL DEFAULT '', lots_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS transfer_docs_order ON transfer_docs(created_at DESC,id);
CREATE INDEX IF NOT EXISTS transfer_lines_document ON transfer_lines(transfer_id);
CREATE TABLE IF NOT EXISTS transfer_outbox (
 id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, to_device_id TEXT NOT NULL,
 payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transfer_inbox (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS transfer_returns (
 id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL UNIQUE REFERENCES transfer_docs(id),
 number TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'return_pending',
 lines_json TEXT NOT NULL, created_at INTEGER NOT NULL, confirmed_at INTEGER
);
