-- Stock, for a restaurant.
--
-- A restaurant sells dishes but buys ingredients, so stock cannot hang off
-- menu_items the way it does in a market: one steak sold moves 250 g of beef,
-- not "one steak". Ingredients are therefore their own catalogue, and a recipe
-- is what connects a dish to the things it consumes.
--
-- Quantities are stored as thousandths of the base unit (integer), for the same
-- reason money is stored in minor units: 0.333 kg must not drift.

CREATE TABLE IF NOT EXISTS warehouses (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL DEFAULT 'store'
                CHECK (kind IN ('store','kitchen','bar','cold')),
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredients (
    id            TEXT PRIMARY KEY,
    sku           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    unit          TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg','l','ədəd','qab')),
    -- Cost of one whole unit, in minor currency units.
    cost_minor    INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
    -- Below this the ingredient shows up on the low-stock report. Milli-units.
    min_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (min_qty_milli >= 0),
    barcode       TEXT NOT NULL DEFAULT '',
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingredients_active ON ingredients(active);

-- The running balance. A projection of stock_movements, kept current so the
-- sale path never has to sum a ledger.
CREATE TABLE IF NOT EXISTS stock_levels (
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    qty_milli     INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (ingredient_id, warehouse_id)
);

-- Every change, with its reason. Negative qty_delta_milli takes stock out.
CREATE TABLE IF NOT EXISTS stock_movements (
    id             TEXT PRIMARY KEY,
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    warehouse_id   TEXT NOT NULL REFERENCES warehouses(id),
    kind           TEXT NOT NULL
                   CHECK (kind IN ('receipt','issue','transfer_in','transfer_out',
                                   'waste','adjustment','stocktake','sale')),
    qty_delta_milli INTEGER NOT NULL,
    -- What caused it: an order id, a purchase id, a stocktake id, or ''.
    reference_id   TEXT NOT NULL DEFAULT '',
    reason         TEXT NOT NULL DEFAULT '',
    actor_user_id  TEXT REFERENCES users(id),
    created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_moves_ingredient ON stock_movements(ingredient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_moves_reference ON stock_movements(reference_id);

-- The recipe: what one unit of a dish consumes.
CREATE TABLE IF NOT EXISTS menu_item_ingredients (
    menu_item_id  TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
    PRIMARY KEY (menu_item_id, ingredient_id)
);

-- A physical count. Lines hold what was counted; posting writes the difference
-- to stock_movements so the ledger still explains every change.
CREATE TABLE IF NOT EXISTS stocktakes (
    id            TEXT PRIMARY KEY,
    warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
    status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','counted','posted','cancelled')),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    posted_at     INTEGER
);

CREATE TABLE IF NOT EXISTS stocktake_lines (
    id             TEXT PRIMARY KEY,
    stocktake_id   TEXT NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    expected_milli INTEGER NOT NULL DEFAULT 0,
    counted_milli  INTEGER,
    UNIQUE (stocktake_id, ingredient_id)
);

INSERT OR IGNORE INTO warehouses (id, name, kind, sort_order, created_at, updated_at)
VALUES ('wh-main', 'Əsas anbar', 'store', 1,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000);
