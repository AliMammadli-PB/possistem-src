-- Returning goods to a supplier (Alışlar, 1.7.25).
--
-- A return takes the goods out of the store and the same money off the
-- supplier's debt. The debt side is a negative 'charge' in supplier_ledger, so
-- the existing balance (charges minus payments) needs no change; these tables
-- keep the document itself: what went back, from which invoice, at what price.

CREATE TABLE IF NOT EXISTS purchase_returns (
    id            TEXT PRIMARY KEY,
    number        TEXT NOT NULL UNIQUE,
    supplier_id   TEXT NOT NULL REFERENCES suppliers(id),
    purchase_id   TEXT REFERENCES purchase_orders(id),
    warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
    total_minor   INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(purchase_id);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id               TEXT PRIMARY KEY,
    return_id        TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    ingredient_id    TEXT NOT NULL REFERENCES ingredients(id),
    qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_cost_minor  INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
    line_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (line_total_minor >= 0)
);
