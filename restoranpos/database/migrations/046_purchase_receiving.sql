-- Partial receiving, supplier invoice matching and landed costs (1.7.28).
--
-- purchase_orders.status carries a CHECK without 'partially_received', and the
-- table cannot be rebuilt: supplier_ledger and purchase_returns point at it
-- without ON DELETE CASCADE, so a DROP under foreign_keys=ON would fail or
-- lose rows. The full lifecycle therefore lives in a new `stage` column
-- (draft | ordered | partially_received | received | cancelled); `status`
-- stays as the legacy projection ('ordered' while partly received).
--
-- Only ADD COLUMN, CREATE TABLE and backfills: nothing is deleted.

ALTER TABLE purchase_orders ADD COLUMN stage TEXT NOT NULL DEFAULT 'ordered';
ALTER TABLE purchase_orders ADD COLUMN ordered_at INTEGER;
ALTER TABLE purchase_orders ADD COLUMN expected_at INTEGER;
ALTER TABLE purchase_orders ADD COLUMN supplier_invoice_no TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN supplier_invoice_date TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN invoice_confirmed_at INTEGER;
-- What has been put on the supplier's account for this invoice so far; every
-- change to it is one supplier_ledger row for the difference.
ALTER TABLE purchase_orders ADD COLUMN charged_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN auto_draft INTEGER NOT NULL DEFAULT 0;

UPDATE purchase_orders SET stage = status, ordered_at = created_at;
UPDATE purchase_orders SET charged_minor = total_minor WHERE status = 'received';

ALTER TABLE purchase_order_items ADD COLUMN received_milli INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN pending_milli INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN rejected_milli INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN invoice_qty_milli INTEGER;
ALTER TABLE purchase_order_items ADD COLUMN invoice_unit_cost_minor INTEGER;
ALTER TABLE purchase_order_items ADD COLUMN landed_unit_cost_minor INTEGER NOT NULL DEFAULT 0;

UPDATE purchase_order_items SET received_milli = qty_milli, landed_unit_cost_minor = unit_cost_minor
WHERE purchase_id IN (SELECT id FROM purchase_orders WHERE status = 'received');
UPDATE purchase_order_items SET landed_unit_cost_minor = unit_cost_minor WHERE landed_unit_cost_minor = 0;

-- One row per delivery: an invoice can arrive in several.
CREATE TABLE IF NOT EXISTS purchase_receipts (
    id            TEXT PRIMARY KEY,
    purchase_id   TEXT NOT NULL REFERENCES purchase_orders(id),
    number        TEXT NOT NULL,
    warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts ON purchase_receipts(purchase_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
    id             TEXT PRIMARY KEY,
    receipt_id     TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
    item_id        TEXT NOT NULL,
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    qty_milli      INTEGER NOT NULL DEFAULT 0,
    rejected_milli INTEGER NOT NULL DEFAULT 0,
    quality        TEXT NOT NULL DEFAULT 'accepted' CHECK (quality IN ('accepted','pending','rejected')),
    lot_id         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines ON purchase_receipt_lines(receipt_id);

-- Delivery, transport and the like, spread over the goods' cost.
CREATE TABLE IF NOT EXISTS purchase_costs (
    id           TEXT PRIMARY KEY,
    purchase_id  TEXT NOT NULL REFERENCES purchase_orders(id),
    kind         TEXT NOT NULL DEFAULT 'delivery' CHECK (kind IN ('delivery','transport','customs','other')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    -- 1: the supplier bills it (onto their debt); 0: paid to someone else.
    to_supplier  INTEGER NOT NULL DEFAULT 1 CHECK (to_supplier IN (0,1)),
    account_id   TEXT NOT NULL DEFAULT '',
    allocation   TEXT NOT NULL DEFAULT 'value' CHECK (allocation IN ('value','qty')),
    note         TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_costs ON purchase_costs(purchase_id);
