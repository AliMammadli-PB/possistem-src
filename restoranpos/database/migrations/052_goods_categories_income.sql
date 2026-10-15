-- Goods, categories, branch prices, stocktake documents and income (1.9.0).
--
--   stock_categories  - a tree (parent_id) the goods are filed under.
--   ingredients.category_id / plu / weighted
--                     - a good's category; for scales its PLU number and
--                       whether it is sold by weight.
--   item_prices       - a good's sale price in one branch (obyekt) when it
--                       differs from its own price.
--   stocktakes.number / zero_uncounted / *_total
--                     - the count is two documents: what the books said when
--                       it started, and what was counted; posting loads the
--                       counted quantities as the stock.
--   income_docs       - money that came into a kassa from outside sales.
--   external_sales    - Market POS sales already recorded here (by their id).

CREATE TABLE IF NOT EXISTS stock_categories (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT REFERENCES stock_categories(id),
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_categories_parent ON stock_categories(parent_id);

ALTER TABLE ingredients ADD COLUMN category_id TEXT REFERENCES stock_categories(id);
ALTER TABLE ingredients ADD COLUMN plu INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN weighted INTEGER NOT NULL DEFAULT 0 CHECK (weighted IN (0,1));
UPDATE ingredients SET weighted = 1 WHERE unit IN ('kg', 'l', 'q');
CREATE INDEX IF NOT EXISTS idx_ingredients_barcode ON ingredients(barcode);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category_id);

CREATE TABLE IF NOT EXISTS item_prices (
    ingredient_id    TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    object_id        TEXT NOT NULL REFERENCES cash_objects(id) ON DELETE CASCADE,
    sale_price_minor INTEGER NOT NULL CHECK (sale_price_minor >= 0),
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (ingredient_id, object_id)
);

ALTER TABLE stocktakes ADD COLUMN number TEXT NOT NULL DEFAULT '';
ALTER TABLE stocktakes ADD COLUMN zero_uncounted INTEGER NOT NULL DEFAULT 1 CHECK (zero_uncounted IN (0,1));
ALTER TABLE stocktake_lines ADD COLUMN posted_before_milli INTEGER;
ALTER TABLE stocktake_lines ADD COLUMN counted_at INTEGER;
UPDATE stocktakes SET number = 'S-' || substr('00000' || rowid, -5) WHERE number = '';

CREATE TABLE IF NOT EXISTS income_docs (
    id            TEXT PRIMARY KEY,
    number        TEXT NOT NULL,
    object_id     TEXT NOT NULL DEFAULT '',
    account_id    TEXT NOT NULL DEFAULT '',
    kind          TEXT NOT NULL DEFAULT '',
    reason        TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
    doc_at        INTEGER NOT NULL,
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_income_docs_at ON income_docs(doc_at);

CREATE TABLE IF NOT EXISTS external_sales (
    external_id TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id),
    kind        TEXT NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale','refund')),
    created_at  INTEGER NOT NULL
);

