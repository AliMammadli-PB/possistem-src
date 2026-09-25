-- ============================================================================
-- 002 - Business days and immutable X/Z report snapshots
-- ============================================================================

CREATE TABLE business_days (
    id                    TEXT PRIMARY KEY,
    business_date         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','closing','closed')),
    opened_at             INTEGER NOT NULL,
    opened_by             TEXT REFERENCES users(id),
    closed_at             INTEGER,
    closed_by             TEXT REFERENCES users(id),
    opening_float_minor   INTEGER NOT NULL DEFAULT 0,
    counted_cash_minor    INTEGER,
    expected_cash_minor   INTEGER,
    cash_variance_minor   INTEGER,
    note                  TEXT NOT NULL DEFAULT '',
    legacy                INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0,1)),
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_business_days_one_open
    ON business_days(status) WHERE status = 'open';

CREATE UNIQUE INDEX idx_business_days_date
    ON business_days(business_date);

CREATE TABLE report_snapshots (
    id              TEXT PRIMARY KEY,
    business_day_id TEXT NOT NULL REFERENCES business_days(id),
    kind            TEXT NOT NULL CHECK (kind IN ('x','z','shift')),
    sequence_no     INTEGER NOT NULL DEFAULT 1,
    canonical_json  TEXT NOT NULL,
    content_sha256  TEXT NOT NULL,
    totals_json     TEXT NOT NULL DEFAULT '{}',
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    UNIQUE (business_day_id, kind, sequence_no)
);

CREATE INDEX idx_report_snapshots_day ON report_snapshots(business_day_id, kind);

CREATE TRIGGER report_snapshots_no_update
BEFORE UPDATE ON report_snapshots
BEGIN
    SELECT RAISE(ABORT, 'report_snapshots is immutable');
END;

CREATE TRIGGER report_snapshots_no_delete
BEFORE DELETE ON report_snapshots
BEGIN
    SELECT RAISE(ABORT, 'report_snapshots is immutable');
END;

CREATE TABLE x_reports (
    id              TEXT PRIMARY KEY,
    business_day_id TEXT NOT NULL REFERENCES business_days(id),
    snapshot_id     TEXT NOT NULL UNIQUE REFERENCES report_snapshots(id),
    sequence_no     INTEGER NOT NULL,
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    UNIQUE (business_day_id, sequence_no)
);

CREATE TABLE z_reports (
    id              TEXT PRIMARY KEY,
    business_day_id TEXT NOT NULL UNIQUE REFERENCES business_days(id),
    snapshot_id     TEXT NOT NULL UNIQUE REFERENCES report_snapshots(id),
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL
);

CREATE TRIGGER x_reports_no_update
BEFORE UPDATE ON x_reports
BEGIN
    SELECT RAISE(ABORT, 'x_reports is immutable');
END;

CREATE TRIGGER x_reports_no_delete
BEFORE DELETE ON x_reports
BEGIN
    SELECT RAISE(ABORT, 'x_reports is immutable');
END;

CREATE TRIGGER z_reports_no_update
BEFORE UPDATE ON z_reports
BEGIN
    SELECT RAISE(ABORT, 'z_reports is immutable');
END;

CREATE TRIGGER z_reports_no_delete
BEFORE DELETE ON z_reports
BEGIN
    SELECT RAISE(ABORT, 'z_reports is immutable');
END;

ALTER TABLE shifts ADD COLUMN business_day_id TEXT REFERENCES business_days(id);
ALTER TABLE orders ADD COLUMN business_day_id TEXT REFERENCES business_days(id);
ALTER TABLE payments ADD COLUMN business_day_id TEXT REFERENCES business_days(id);

CREATE INDEX idx_shifts_business_day ON shifts(business_day_id);
CREATE INDEX idx_orders_business_day ON orders(business_day_id);
CREATE INDEX idx_payments_business_day ON payments(business_day_id);

-- Seed a legacy open business day for any already-open shifts/orders so v1
-- installs keep working after upgrade without forcing an immediate Z close.
INSERT INTO business_days (
    id, business_date, status, opened_at, opened_by, opening_float_minor,
    note, legacy, created_at, updated_at
)
SELECT
    'bday-legacy-v1',
    date('now', 'localtime'),
    'open',
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    NULL,
    0,
    'Auto-created during 1.0.7 → 1.1.0 migration',
    1,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE EXISTS (
    SELECT 1 FROM shifts WHERE status = 'open'
    UNION ALL
    SELECT 1 FROM orders WHERE status IN ('draft','open','sent','partially_paid')
)
AND NOT EXISTS (SELECT 1 FROM business_days WHERE status = 'open');

UPDATE shifts
SET business_day_id = (SELECT id FROM business_days WHERE status = 'open' LIMIT 1)
WHERE status = 'open' AND business_day_id IS NULL;

UPDATE orders
SET business_day_id = (SELECT id FROM business_days WHERE status = 'open' LIMIT 1)
WHERE status IN ('draft','open','sent','partially_paid') AND business_day_id IS NULL;

UPDATE payments
SET business_day_id = (
    SELECT o.business_day_id FROM orders o WHERE o.id = payments.order_id
)
WHERE business_day_id IS NULL;
