-- Where stock comes from.
--
-- Receiving a purchase is the only way stock enters the building on purpose, so
-- it writes the same stock_movements rows everything else reads - there is no
-- second source of truth for what is in the store.
CREATE TABLE IF NOT EXISTS suppliers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    contact      TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    tax_id       TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id            TEXT PRIMARY KEY,
    number        TEXT NOT NULL UNIQUE,
    supplier_id   TEXT NOT NULL REFERENCES suppliers(id),
    warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','ordered','received','cancelled')),
    total_minor   INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    -- What is still owed on this invoice; paying it down writes a ledger row.
    due_minor     INTEGER NOT NULL DEFAULT 0 CHECK (due_minor >= 0),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    received_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchase_orders(supplier_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id             TEXT PRIMARY KEY,
    purchase_id    TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    qty_milli      INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
    line_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (line_total_minor >= 0)
);

-- Money owed to and paid to a supplier. Positive charges, negative payments.
CREATE TABLE IF NOT EXISTS supplier_ledger (
    id            TEXT PRIMARY KEY,
    supplier_id   TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    purchase_id   TEXT REFERENCES purchase_orders(id),
    amount_minor  INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('charge','payment')),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger ON supplier_ledger(supplier_id, created_at);
