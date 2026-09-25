-- Milioner 1.2.2 floor: Zal 16, Bar 2, Kabinet 3.
-- Existing table ids are kept so historical and live orders stay attached.

-- A live Bar order must be one of the two retained Bar tables.  Abort safely
-- if more than two real live orders exist; silently discarding a table is never
-- acceptable. Empty zero-value drafts are handled by the normal table cleanup.
CREATE TEMP TABLE _floor_guard_122 (
    protected_bar_tables INTEGER NOT NULL CHECK (protected_bar_tables <= 2)
);
INSERT INTO _floor_guard_122(protected_bar_tables)
SELECT COUNT(DISTINCT t.id)
FROM restaurant_tables t
JOIN orders o ON o.table_id = t.id
WHERE t.area_id = 'area-bar'
  AND t.active = 1
  AND o.status IN ('draft','open','sent','partially_paid')
  AND (
      o.total_minor > 0 OR o.paid_minor > 0 OR
      EXISTS (SELECT 1 FROM order_items i
              WHERE i.order_id = o.id AND i.status != 'voided') OR
      EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
  );

-- Empty drafts on Bar tables do not reserve one of the two operational slots.
UPDATE orders
SET status = 'voided', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
    row_version = row_version + 1
WHERE table_id IN (
        SELECT id FROM restaurant_tables
        WHERE area_id = 'area-bar' AND active = 1
      )
  AND status = 'draft' AND total_minor = 0 AND paid_minor = 0
  AND NOT EXISTS (SELECT 1 FROM order_items i
                  WHERE i.order_id = orders.id AND i.status != 'voided')
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id);

-- Ten existing hall tables plus the six terrace tables become Zal 1..16.
UPDATE restaurant_areas
SET name_az = 'Zal', name_tr = 'Salon', name_en = 'Hall', sort_order = 1, active = 1
WHERE id = 'area-salon';

UPDATE restaurant_tables
SET area_id = 'area-salon', active = 1,
    label = CAST(CASE
        WHEN id GLOB 'tbl-[0-9][0-9]' THEN CAST(substr(id, 5) AS INTEGER)
        ELSE sort_order
    END AS TEXT),
    sort_order = CASE
        WHEN id GLOB 'tbl-[0-9][0-9]' THEN CAST(substr(id, 5) AS INTEGER)
        ELSE sort_order
    END,
    pos_x = (CASE
        WHEN id GLOB 'tbl-[0-9][0-9]' THEN CAST(substr(id, 5) AS INTEGER) - 1
        ELSE sort_order - 1
    END) % 4,
    pos_y = (CASE
        WHEN id GLOB 'tbl-[0-9][0-9]' THEN CAST(substr(id, 5) AS INTEGER) - 1
        ELSE sort_order - 1
    END) / 4,
    width = 1, height = 1, shape = 'square',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE active = 1 AND area_id IN ('area-salon','area-terrace')
  AND id IN ('tbl-01','tbl-02','tbl-03','tbl-04','tbl-05','tbl-06','tbl-07','tbl-08',
             'tbl-09','tbl-10','tbl-11','tbl-12','tbl-13','tbl-14','tbl-15','tbl-16');

UPDATE restaurant_areas SET active = 0 WHERE id = 'area-terrace';

-- VIP becomes Kabinet and keeps all three ids/orders.
UPDATE restaurant_areas
SET name_az = 'Kabinet', name_tr = 'Kabinet', name_en = 'Private Room',
    sort_order = 3, active = 1
WHERE id = 'area-vip';

UPDATE restaurant_tables
SET label = 'K' || CAST(CAST(substr(id, 5) AS INTEGER) - 16 AS TEXT),
    sort_order = CAST(substr(id, 5) AS INTEGER) - 16,
    pos_x = CAST(substr(id, 5) AS INTEGER) - 17,
    pos_y = 0, width = 1, height = 1, shape = 'square', active = 1,
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE area_id = 'area-vip' AND id IN ('tbl-17','tbl-18','tbl-19');

UPDATE restaurant_areas SET sort_order = 2, active = 1 WHERE id = 'area-bar';

-- Rank Bar tables with a protected live order first, then by old sort order.
CREATE TEMP TABLE _bar_keep_122 (
    table_id TEXT PRIMARY KEY,
    slot INTEGER NOT NULL
);
INSERT INTO _bar_keep_122(table_id, slot)
SELECT id, rn FROM (
    SELECT t.id,
           ROW_NUMBER() OVER (
             ORDER BY CASE WHEN EXISTS (
                 SELECT 1 FROM orders o
                 WHERE o.table_id = t.id
                   AND o.status IN ('draft','open','sent','partially_paid')
                   AND (o.total_minor > 0 OR o.paid_minor > 0 OR
                        EXISTS (SELECT 1 FROM order_items i
                                WHERE i.order_id = o.id AND i.status != 'voided') OR
                        EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id))
             ) THEN 0 ELSE 1 END,
             t.sort_order, t.id
           ) AS rn
    FROM restaurant_tables t
    WHERE t.area_id = 'area-bar' AND t.active = 1
) ranked
WHERE rn <= 2;

UPDATE restaurant_tables
SET active = CASE WHEN id IN (SELECT table_id FROM _bar_keep_122) THEN 1 ELSE 0 END,
    label = CASE
      WHEN id IN (SELECT table_id FROM _bar_keep_122)
      THEN 'B' || CAST((SELECT slot FROM _bar_keep_122 k WHERE k.table_id = restaurant_tables.id) AS TEXT)
      ELSE label
    END,
    sort_order = CASE
      WHEN id IN (SELECT table_id FROM _bar_keep_122)
      THEN (SELECT slot FROM _bar_keep_122 k WHERE k.table_id = restaurant_tables.id)
      ELSE sort_order
    END,
    pos_x = CASE
      WHEN id IN (SELECT table_id FROM _bar_keep_122)
      THEN (SELECT slot - 1 FROM _bar_keep_122 k WHERE k.table_id = restaurant_tables.id)
      ELSE pos_x
    END,
    pos_y = 0, width = 1, height = 1, shape = 'bar',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE area_id = 'area-bar';

DROP TABLE _bar_keep_122;
DROP TABLE _floor_guard_122;

