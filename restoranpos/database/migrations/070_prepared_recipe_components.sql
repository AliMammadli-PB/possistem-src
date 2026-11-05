-- 1.10.4. A dish with its own recipe, added to another recipe through its stock card, took the
-- card out of stock and left its raw materials untouched. Such lines become ready-made recipe
-- parts, same quantity. A line that would close a cycle or pass the 8 levels the view walks stays.
CREATE TABLE _m070_lines AS
WITH RECURSIVE
cand(menu, part, ing, qty) AS (
  SELECT r.menu_item_id, l.menu_id, r.ingredient_id, r.qty_milli
  FROM menu_item_ingredients r
  JOIN catalog_goods_links l ON l.ingredient_id = r.ingredient_id
  JOIN menu_items m ON m.id = l.menu_id
  WHERE l.menu_id <> r.menu_item_id AND m.active = 1 AND m.archived = 0 AND r.qty_milli <= 100000
    AND (EXISTS (SELECT 1 FROM menu_item_components c WHERE c.menu_item_id = l.menu_id)
         OR EXISTS (SELECT 1 FROM menu_item_ingredients raw
                    WHERE raw.menu_item_id = l.menu_id AND raw.ingredient_id <> l.ingredient_id))
),
edge(a, b) AS (
  SELECT menu, part FROM cand UNION SELECT menu_item_id, component_menu_item_id FROM menu_item_components
),
down(seed, item, n) AS (
  SELECT part, part, 0 FROM cand
  UNION SELECT d.seed, e.b, d.n + 1 FROM down d JOIN edge e ON e.a = d.item WHERE d.n < 9
),
up(seed, item, n) AS (
  SELECT menu, menu, 0 FROM cand
  UNION SELECT u.seed, e.a, u.n + 1 FROM up u JOIN edge e ON e.b = u.item WHERE u.n < 9
)
SELECT c.menu, c.part, c.ing, c.qty FROM cand c
WHERE NOT EXISTS (SELECT 1 FROM down d WHERE d.seed = c.part AND d.item = c.menu)
  AND (SELECT MAX(n) FROM up WHERE seed = c.menu) + 1 + (SELECT MAX(n) FROM down WHERE seed = c.part) <= 8;

INSERT INTO menu_item_components(menu_item_id, component_menu_item_id, qty_milli)
SELECT menu, part, qty FROM _m070_lines WHERE true
ON CONFLICT(menu_item_id, component_menu_item_id) DO NOTHING;

DELETE FROM menu_item_ingredients
WHERE (menu_item_id, ingredient_id) IN (SELECT menu, ing FROM _m070_lines);

DROP TABLE _m070_lines;
