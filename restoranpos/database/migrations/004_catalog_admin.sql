-- ============================================================================
-- 004 - Catalog admin: price history, barcodes, schedules, archive
-- ============================================================================

ALTER TABLE menu_items ADD COLUMN barcode TEXT;
ALTER TABLE menu_items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));
ALTER TABLE menu_items ADD COLUMN kitchen_route TEXT NOT NULL DEFAULT '';
ALTER TABLE menu_items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE menu_categories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));

CREATE UNIQUE INDEX idx_menu_items_barcode
    ON menu_items(barcode) WHERE barcode IS NOT NULL AND barcode != '';

CREATE TABLE menu_item_price_history (
    id               TEXT PRIMARY KEY,
    item_id          TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    old_price_minor  INTEGER NOT NULL,
    new_price_minor  INTEGER NOT NULL,
    changed_by       TEXT REFERENCES users(id),
    reason           TEXT NOT NULL DEFAULT '',
    created_at       INTEGER NOT NULL
);

CREATE INDEX idx_price_history_item ON menu_item_price_history(item_id, created_at);

CREATE TABLE menu_item_schedules (
    id          TEXT PRIMARY KEY,
    item_id     TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_minute INTEGER NOT NULL DEFAULT 0 CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute   INTEGER NOT NULL DEFAULT 1439 CHECK (end_minute BETWEEN 0 AND 1439),
    available    INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    CHECK (end_minute >= start_minute)
);

CREATE INDEX idx_item_schedules_item ON menu_item_schedules(item_id);

CREATE TABLE catalog_import_batches (
    id              TEXT PRIMARY KEY,
    filename        TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'preview'
                    CHECK (status IN ('preview','committed','cancelled','failed')),
    preview_json    TEXT NOT NULL DEFAULT '{}',
    result_json     TEXT NOT NULL DEFAULT '{}',
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    committed_at    INTEGER
);

CREATE INDEX idx_catalog_import_created ON catalog_import_batches(created_at);
