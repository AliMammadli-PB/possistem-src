-- Single-stock model: collapse every warehouse into one.
--
-- Two faults are repaired here.
--
-- 1. `settings.defaultWarehouseId` could name a warehouse that does not exist.
--    The seed ships 'wh-sales', but a shop that creates its own warehouses
--    never gets that row and nothing ever rewrites the setting. Because
--    stock_levels.warehouse_id carries a real FK and foreign_keys is ON, this
--    does not merely display 0 — every sale fails on SQLITE_CONSTRAINT and
--    rolls back, so the till cannot trade at all.
--
-- 2. Stock was split across warehouses while the register read exactly one of
--    them, so quantity typed into the wrong field was invisible at the till.
--
-- Deliberately minimal: the runtime resolver in Warehouse.cpp handles anything
-- this cannot, and a migration that throws would brick startup.
--
-- Not done here, on purpose:
--   * no warehouse is created when the table is empty — a fresh install adopts
--     whichever warehouse it is later given
--   * `warehouses` rows are never deleted — stock_levels.warehouse_id cascades
--   * `product_lots` is left alone — UNIQUE(product_id, warehouse_id,
--     lot_number) makes the same lot number in two warehouses legal today, so
--     repointing it can collide
PRAGMA foreign_keys = ON;

-- The surviving warehouse: the configured one when it is real, else the seeded
-- sales floor, else the lowest id so every till picks deterministically.
CREATE TEMP TABLE _wh_pick AS
SELECT COALESCE(
  (SELECT w.id FROM warehouses w
     JOIN settings s ON s.key = 'defaultWarehouseId' AND s.value = w.id
    LIMIT 1),
  (SELECT id FROM warehouses WHERE id = 'wh-sales' LIMIT 1),
  (SELECT id FROM warehouses ORDER BY id LIMIT 1)
) AS id;

-- Delete-then-insert because SQLite cannot UPDATE a row onto an existing
-- primary key, and (product_id, warehouse_id) is that key.
CREATE TEMP TABLE _collapsed AS
SELECT product_id, SUM(qty) AS qty FROM stock_levels GROUP BY product_id;

DELETE FROM stock_levels WHERE (SELECT id FROM _wh_pick) IS NOT NULL;

INSERT INTO stock_levels (product_id, warehouse_id, qty)
SELECT c.product_id, (SELECT id FROM _wh_pick), c.qty
FROM _collapsed c
WHERE (SELECT id FROM _wh_pick) IS NOT NULL;

INSERT INTO settings (key, value)
SELECT 'defaultWarehouseId', id FROM _wh_pick WHERE id IS NOT NULL
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- The replication clock keyed stock as "<productId>@<warehouseId>". With one
-- warehouse the suffix only stops two tills from arbitrating the same product,
-- so re-key to the bare product id and keep the newest clock per product.
CREATE TEMP TABLE _stock_clock AS
SELECT
  substr(entity_id, 1, instr(entity_id, '@') - 1) AS product_id,
  MAX(logical_at) AS logical_at
FROM sync_catalog_clock
WHERE entity_type = 'stock' AND instr(entity_id, '@') > 0
GROUP BY 1;

DELETE FROM sync_catalog_clock WHERE entity_type = 'stock';

INSERT INTO sync_catalog_clock (entity_type, entity_id, logical_at, origin_device_id)
SELECT 'stock', c.product_id, c.logical_at, ''
FROM _stock_clock c
WHERE c.product_id <> '';

DROP TABLE _stock_clock;
DROP TABLE _collapsed;
DROP TABLE _wh_pick;
