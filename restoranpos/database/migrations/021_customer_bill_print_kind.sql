-- ============================================================================
-- 021 - Preliminary customer bill print kind
-- ============================================================================
-- A guest may ask for the current bill before paying and may continue ordering
-- afterwards. Keep that paper separate from the final payment receipt.

CREATE TABLE print_jobs_v21 (
    id              TEXT PRIMARY KEY,
    order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
    receipt_id      TEXT,
    kind            TEXT NOT NULL CHECK (kind IN (
                        'kitchen_ticket','customer_bill','customer_receipt','shift_report',
                        'test_page','x_report','z_report','refund_receipt')),
    target_printer  TEXT NOT NULL DEFAULT 'virtual',
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','processing','sent','failed','retrying','completed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    last_error      TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT UNIQUE,
    next_attempt_at INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

INSERT INTO print_jobs_v21
SELECT id, order_id, receipt_id, kind, target_printer, status, attempts, max_attempts,
       last_error, payload, idempotency_key, next_attempt_at, created_at, updated_at
FROM print_jobs;

DROP TABLE print_jobs;

CREATE TABLE receipts_v21 (
    id                 TEXT PRIMARY KEY,
    order_id           TEXT REFERENCES orders(id) ON DELETE CASCADE,
    kind               TEXT NOT NULL CHECK (kind IN (
                           'kitchen_ticket','customer_bill','customer_receipt','shift_report',
                           'test_page','x_report','z_report','refund_receipt')),
    number             TEXT NOT NULL,
    content_text       TEXT NOT NULL DEFAULT '',
    content_json       TEXT NOT NULL DEFAULT '{}',
    total_minor        INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    business_day_id    TEXT REFERENCES business_days(id),
    report_snapshot_id TEXT REFERENCES report_snapshots(id)
);

INSERT INTO receipts_v21
SELECT id, order_id, kind, number, content_text, content_json, total_minor, created_at,
       business_day_id, report_snapshot_id
FROM receipts;

DROP TABLE receipts;
ALTER TABLE receipts_v21 RENAME TO receipts;
CREATE INDEX idx_receipts_order ON receipts(order_id);
CREATE INDEX idx_receipts_kind ON receipts(kind, created_at);

ALTER TABLE print_jobs_v21 RENAME TO print_jobs;

CREATE TABLE print_jobs_final_v21 (
    id              TEXT PRIMARY KEY,
    order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
    receipt_id      TEXT REFERENCES receipts(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN (
                        'kitchen_ticket','customer_bill','customer_receipt','shift_report',
                        'test_page','x_report','z_report','refund_receipt')),
    target_printer  TEXT NOT NULL DEFAULT 'virtual',
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','processing','sent','failed','retrying','completed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    last_error      TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT UNIQUE,
    next_attempt_at INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

INSERT INTO print_jobs_final_v21
SELECT id, order_id, receipt_id, kind, target_printer, status, attempts, max_attempts,
       last_error, payload, idempotency_key, next_attempt_at, created_at, updated_at
FROM print_jobs;

DROP TABLE print_jobs;
ALTER TABLE print_jobs_final_v21 RENAME TO print_jobs;
CREATE INDEX idx_print_jobs_status ON print_jobs(status, next_attempt_at);
