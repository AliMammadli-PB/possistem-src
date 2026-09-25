-- ============================================================================
-- 006 - Cash drawer, discounts, refund ledger, mixed tenders, bill splits
-- ============================================================================

CREATE TABLE cash_movements (
    id                TEXT PRIMARY KEY,
    business_day_id   TEXT REFERENCES business_days(id),
    shift_id          TEXT REFERENCES shifts(id),
    kind              TEXT NOT NULL
                      CHECK (kind IN ('cash_in','cash_out','expense','float_adjust','drawer_open')),
    amount_minor      INTEGER NOT NULL CHECK (amount_minor >= 0),
    reason            TEXT NOT NULL DEFAULT '',
    note              TEXT NOT NULL DEFAULT '',
    actor_user_id     TEXT REFERENCES users(id),
    approved_by       TEXT REFERENCES users(id),
    created_at        INTEGER NOT NULL
);

CREATE INDEX idx_cash_movements_day ON cash_movements(business_day_id, created_at);
CREATE INDEX idx_cash_movements_shift ON cash_movements(shift_id);

CREATE TABLE discount_rules (
    id                TEXT PRIMARY KEY,
    name_az           TEXT NOT NULL,
    name_tr           TEXT NOT NULL DEFAULT '',
    name_en           TEXT NOT NULL DEFAULT '',
    kind              TEXT NOT NULL CHECK (kind IN ('percent','amount','complimentary')),
    value_minor       INTEGER NOT NULL DEFAULT 0,
    max_percent       INTEGER,
    requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0,1)),
    active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE void_reasons (
    id       TEXT PRIMARY KEY,
    code     TEXT NOT NULL UNIQUE,
    label_az TEXT NOT NULL,
    label_tr TEXT NOT NULL DEFAULT '',
    label_en TEXT NOT NULL DEFAULT '',
    active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE refunds (
    id                 TEXT PRIMARY KEY,
    order_id           TEXT NOT NULL REFERENCES orders(id),
    payment_id         TEXT NOT NULL REFERENCES payments(id),
    business_day_id    TEXT REFERENCES business_days(id),
    amount_minor       INTEGER NOT NULL CHECK (amount_minor > 0),
    tip_refund_minor   INTEGER NOT NULL DEFAULT 0,
    reason             TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'completed'
                       CHECK (status IN ('pending','completed','failed','canceled')),
    method             TEXT NOT NULL CHECK (method IN ('cash','card','mixed','complimentary')),
    actor_user_id      TEXT REFERENCES users(id),
    approved_by        TEXT REFERENCES users(id),
    receipt_id         TEXT,
    idempotency_key    TEXT UNIQUE,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);

CREATE INDEX idx_refunds_payment ON refunds(payment_id);
CREATE INDEX idx_refunds_order ON refunds(order_id);
CREATE INDEX idx_refunds_day ON refunds(business_day_id);

CREATE TABLE refund_items (
    id                TEXT PRIMARY KEY,
    refund_id         TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
    order_item_id     TEXT REFERENCES order_items(id),
    quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    amount_minor      INTEGER NOT NULL CHECK (amount_minor >= 0),
    name_snapshot     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_refund_items_refund ON refund_items(refund_id);

CREATE TABLE payment_tenders (
    id              TEXT PRIMARY KEY,
    payment_id      TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    method          TEXT NOT NULL CHECK (method IN ('cash','card','complimentary')),
    amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),
    tip_minor       INTEGER NOT NULL DEFAULT 0,
    tendered_minor  INTEGER NOT NULL DEFAULT 0,
    change_minor    INTEGER NOT NULL DEFAULT 0,
    card_last4      TEXT NOT NULL DEFAULT '',
    terminal_ref    TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_payment_tenders_payment ON payment_tenders(payment_id);

CREATE TABLE bill_splits (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('equal','by_seat','by_item','custom')),
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','partial','settled','canceled')),
    parts_json      TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_bill_splits_order ON bill_splits(order_id);

CREATE TABLE bill_split_parts (
    id                TEXT PRIMARY KEY,
    split_id          TEXT NOT NULL REFERENCES bill_splits(id) ON DELETE CASCADE,
    label             TEXT NOT NULL DEFAULT '',
    seat              INTEGER,
    amount_minor      INTEGER NOT NULL CHECK (amount_minor >= 0),
    paid_minor        INTEGER NOT NULL DEFAULT 0,
    payment_id        TEXT REFERENCES payments(id),
    sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_bill_split_parts_split ON bill_split_parts(split_id);

INSERT INTO void_reasons (id, code, label_az, label_tr, label_en, sort_order) VALUES
  ('void-wrong-item', 'wrong_item', 'Səhv məhsul', 'Yanlış ürün', 'Wrong item', 1),
  ('void-customer',   'customer_request', 'Müştəri istəyi', 'Müşteri talebi', 'Customer request', 2),
  ('void-kitchen',    'kitchen_error', 'Mətbəx xətası', 'Mutfak hatası', 'Kitchen error', 3),
  ('void-duplicate',  'duplicate', 'Təkrar sifariş', 'Çift sipariş', 'Duplicate', 4),
  ('void-other',      'other', 'Digər', 'Diğer', 'Other', 5);

INSERT INTO discount_rules (id, name_az, name_tr, name_en, kind, value_minor, max_percent,
                            requires_approval, active, created_at, updated_at) VALUES
  ('disc-10pct', '10% endirim', '10% indirim', '10% discount', 'percent', 10, 10, 0, 1,
   CAST(strftime('%s','now') AS INTEGER) * 1000,
   CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('disc-staff', 'Personal endirimi', 'Personel indirimi', 'Staff discount', 'percent', 20, 20, 1, 1,
   CAST(strftime('%s','now') AS INTEGER) * 1000,
   CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('disc-comp', 'Kompliment', 'İkram', 'Complimentary', 'complimentary', 0, NULL, 1, 1,
   CAST(strftime('%s','now') AS INTEGER) * 1000,
   CAST(strftime('%s','now') AS INTEGER) * 1000);
