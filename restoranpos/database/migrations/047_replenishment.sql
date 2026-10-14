-- Automatic replenishment and supplier prices (1.7.28).
--
--   stock_rules            - per ingredient and store: below `min` a draft
--                            purchase is suggested up to `target`, at least
--                            `reorder`. Without a rule the main store keeps
--                            using ingredients.min_qty_milli as before.
--   supplier_items         - what each supplier charges for an ingredient and
--                            on what terms (lead time, minimum, pack size).
--   supplier_price_history - every price paid, for comparison and reports.

CREATE TABLE IF NOT EXISTS stock_rules (
    ingredient_id     TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    warehouse_id      TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    min_qty_milli     INTEGER NOT NULL DEFAULT 0 CHECK (min_qty_milli >= 0),
    target_qty_milli  INTEGER NOT NULL DEFAULT 0 CHECK (target_qty_milli >= 0),
    reorder_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_qty_milli >= 0),
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (ingredient_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS supplier_items (
    supplier_id      TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    ingredient_id    TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    last_price_minor INTEGER NOT NULL DEFAULT 0,
    lead_days        INTEGER NOT NULL DEFAULT 0,
    min_order_milli  INTEGER NOT NULL DEFAULT 0,
    pack_milli       INTEGER NOT NULL DEFAULT 0,
    supplier_sku     TEXT NOT NULL DEFAULT '',
    preferred        INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0,1)),
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (supplier_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_items_ingredient ON supplier_items(ingredient_id);

CREATE TABLE IF NOT EXISTS supplier_price_history (
    id            TEXT PRIMARY KEY,
    supplier_id   TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    price_minor   INTEGER NOT NULL,
    purchase_id   TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_price_history ON supplier_price_history(ingredient_id, created_at);

-- What was already bought keeps counting.
INSERT INTO supplier_price_history (id, supplier_id, ingredient_id, price_minor, purchase_id, created_at)
SELECT 'sph-' || lower(hex(randomblob(8))), p.supplier_id, l.ingredient_id, l.unit_cost_minor, p.id,
       COALESCE(p.received_at, p.created_at)
FROM purchase_order_items l JOIN purchase_orders p ON p.id = l.purchase_id
WHERE p.status = 'received' AND l.unit_cost_minor > 0;

INSERT OR REPLACE INTO supplier_items (supplier_id, ingredient_id, last_price_minor, updated_at)
SELECT supplier_id, ingredient_id, price_minor, created_at FROM supplier_price_history ORDER BY created_at;
