-- The print kinds the code has been emitting and the database has been refusing.
--
-- `print_jobs.kind` and `receipts.kind` both carry a CHECK listing the eight
-- kinds that existed in 2021. Two more have been added to the code since:
--
--   period_report  - takings between two instants, printed on demand. The
--                    settings screen offers it and `print.enqueue` builds it,
--                    and every attempt has been failing on this constraint.
--                    Nobody noticed because the failure surfaces as a generic
--                    "could not print" and the button is rarely pressed.
--   warehouse_slip - the goods-receipt note, printed where the goods are.
--
-- SQLite cannot alter a CHECK, so both tables are rebuilt. The copy is the
-- whole table and the column list is written out rather than `SELECT *`, so a
-- column added later cannot silently land in the wrong position.
--
-- Nothing is dropped that is not immediately recreated, and no row is filtered:
-- a till that has printed for three years keeps its history.

CREATE TABLE receipts_v40 (
    id                 TEXT PRIMARY KEY,
    order_id           TEXT REFERENCES orders(id) ON DELETE CASCADE,
    kind               TEXT NOT NULL CHECK (kind IN (
                           'kitchen_ticket','customer_bill','customer_receipt','shift_report',
                           'test_page','x_report','z_report','refund_receipt',
                           'period_report','warehouse_slip')),
    number             TEXT NOT NULL,
    content_text       TEXT NOT NULL DEFAULT '',
    content_json       TEXT NOT NULL DEFAULT '{}',
    total_minor        INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    business_day_id    TEXT REFERENCES business_days(id),
    report_snapshot_id TEXT REFERENCES report_snapshots(id)
);

INSERT INTO receipts_v40 (id, order_id, kind, number, content_text, content_json,
                          total_minor, created_at, business_day_id, report_snapshot_id)
SELECT id, order_id, kind, number, content_text, content_json,
       total_minor, created_at, business_day_id, report_snapshot_id
FROM receipts;

-- print_jobs references receipts(id), so the old receipts table cannot go until
-- the jobs table has been rebuilt against the new one.
CREATE TABLE print_jobs_v40 (
    id              TEXT PRIMARY KEY,
    order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
    receipt_id      TEXT,
    kind            TEXT NOT NULL CHECK (kind IN (
                        'kitchen_ticket','customer_bill','customer_receipt','shift_report',
                        'test_page','x_report','z_report','refund_receipt',
                        'period_report','warehouse_slip')),
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

INSERT INTO print_jobs_v40 (id, order_id, receipt_id, kind, target_printer, status, attempts,
                            max_attempts, last_error, payload, idempotency_key, next_attempt_at,
                            created_at, updated_at)
SELECT id, order_id, receipt_id, kind, target_printer, status, attempts,
       max_attempts, last_error, payload, idempotency_key, next_attempt_at,
       created_at, updated_at
FROM print_jobs;

DROP TABLE print_jobs;
DROP TABLE receipts;

ALTER TABLE receipts_v40 RENAME TO receipts;
CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_kind ON receipts(kind, created_at);
-- Re-created here because dropping the table took it with it; the lookup that
-- finds a sale from the code on a guest's receipt depends on it.
CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(number);

-- Rebuilt once more so receipt_id points at the new receipts table rather than
-- at a name that no longer exists.
CREATE TABLE print_jobs_final_v40 (
    id              TEXT PRIMARY KEY,
    order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
    receipt_id      TEXT REFERENCES receipts(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN (
                        'kitchen_ticket','customer_bill','customer_receipt','shift_report',
                        'test_page','x_report','z_report','refund_receipt',
                        'period_report','warehouse_slip')),
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

INSERT INTO print_jobs_final_v40 (id, order_id, receipt_id, kind, target_printer, status, attempts,
                                  max_attempts, last_error, payload, idempotency_key,
                                  next_attempt_at, created_at, updated_at)
SELECT id, order_id, receipt_id, kind, target_printer, status, attempts,
       max_attempts, last_error, payload, idempotency_key, next_attempt_at,
       created_at, updated_at
FROM print_jobs_v40;

DROP TABLE print_jobs_v40;
ALTER TABLE print_jobs_final_v40 RENAME TO print_jobs;
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, next_attempt_at);
