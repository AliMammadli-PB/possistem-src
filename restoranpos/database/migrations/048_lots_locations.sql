-- Lots, expiry dates and places in the store (1.7.28).
--
-- stock_levels stays the balance every screen reads; stock_lots is the
-- breakdown beneath it, kept by InventoryService::move: goods coming in open a
-- lot, goods going out are taken from lots first-expiring-first-out. Every lot
-- touched is written to stock_lot_moves with the movement that touched it, so
-- a dish sold can be traced to the lot of meat it used.
--
-- Lots in quality 'pending' (quarantine) are not in the balance yet; a
-- 'rejected' lot never is.

CREATE TABLE IF NOT EXISTS stock_locations (
    id           TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'shelf' CHECK (kind IN ('fridge','freezer','shelf','zone','dry')),
    active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_locations ON stock_locations(warehouse_id);

CREATE TABLE IF NOT EXISTS stock_lots (
    id                 TEXT PRIMARY KEY,
    ingredient_id      TEXT NOT NULL REFERENCES ingredients(id),
    warehouse_id       TEXT NOT NULL REFERENCES warehouses(id),
    location_id        TEXT NOT NULL DEFAULT '',
    lot_no             TEXT NOT NULL DEFAULT '',
    purchase_id        TEXT NOT NULL DEFAULT '',
    purchase_item_id   TEXT NOT NULL DEFAULT '',
    produced_on        TEXT NOT NULL DEFAULT '',
    received_at        INTEGER NOT NULL,
    -- 'YYYY-MM-DD', '' when the goods do not expire.
    expires_on         TEXT NOT NULL DEFAULT '',
    qty_received_milli INTEGER NOT NULL DEFAULT 0,
    qty_milli          INTEGER NOT NULL DEFAULT 0 CHECK (qty_milli >= 0),
    unit_cost_minor    INTEGER NOT NULL DEFAULT 0,
    quality            TEXT NOT NULL DEFAULT 'accepted' CHECK (quality IN ('accepted','pending','rejected')),
    created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_pick ON stock_lots(ingredient_id, warehouse_id, quality, qty_milli);
CREATE INDEX IF NOT EXISTS idx_stock_lots_purchase ON stock_lots(purchase_id);

CREATE TABLE IF NOT EXISTS stock_lot_moves (
    id              TEXT PRIMARY KEY,
    lot_id          TEXT NOT NULL REFERENCES stock_lots(id),
    movement_id     TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL,
    qty_delta_milli INTEGER NOT NULL,
    from_location   TEXT NOT NULL DEFAULT '',
    to_location     TEXT NOT NULL DEFAULT '',
    actor_user_id   TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_lot_moves_lot ON stock_lot_moves(lot_id);
CREATE INDEX IF NOT EXISTS idx_stock_lot_moves_movement ON stock_lot_moves(movement_id);

-- Stock already on the shelves becomes one opening lot per ingredient and store,
-- so the lots add up to the balance from the first day.
INSERT INTO stock_lots (id, ingredient_id, warehouse_id, lot_no, received_at, qty_received_milli,
                        qty_milli, unit_cost_minor, quality, created_at)
SELECT 'lot-' || lower(hex(randomblob(8))), s.ingredient_id, s.warehouse_id, 'İLKİN', s.updated_at,
       s.qty_milli, s.qty_milli, i.cost_minor, 'accepted', s.updated_at
FROM stock_levels s JOIN ingredients i ON i.id = s.ingredient_id
WHERE s.qty_milli > 0;
