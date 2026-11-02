-- 1.9.33. One level of sub-categories in the menu (İçkilər → Spirtli / Spirtsiz).
ALTER TABLE menu_categories ADD COLUMN parent_id TEXT REFERENCES menu_categories(id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_parent ON menu_categories(parent_id);

-- Set menus (business lunch): a product made of other products. 1000 = one portion of the part.
-- Its parts' ingredients are taken from stock when the menu is sold. IF NOT EXISTS because tills
-- that once ran the diverged 1.9.25 already have this table and view.
CREATE TABLE IF NOT EXISTS menu_item_components (
    menu_item_id           TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    component_menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    qty_milli              INTEGER NOT NULL CHECK (qty_milli > 0),
    PRIMARY KEY (menu_item_id, component_menu_item_id),
    CHECK (menu_item_id <> component_menu_item_id)
);
CREATE INDEX IF NOT EXISTS idx_menu_item_components_component ON menu_item_components(component_menu_item_id);

-- Every dish as plain ingredient lines, components expanded (depth-limited; saving refuses cycles).
-- A dish's own catalog card line is left out when the dish has real lines or components, so nothing
-- is counted twice. Quantities stay integer thousandths, rounded at each level.
CREATE VIEW IF NOT EXISTS menu_item_recipe_expanded AS
WITH RECURSIVE walk(root, item, factor, depth) AS (
  SELECT id, id, 1000, 0 FROM menu_items
  UNION ALL
  SELECT w.root, c.component_menu_item_id, (w.factor * c.qty_milli + 500) / 1000, w.depth + 1
  FROM walk w JOIN menu_item_components c ON c.menu_item_id = w.item
  WHERE w.depth < 8
)
SELECT w.root AS menu_item_id, r.ingredient_id AS ingredient_id,
       SUM((w.factor * r.qty_milli + 500) / 1000) AS qty_milli
FROM walk w JOIN menu_item_ingredients r ON r.menu_item_id = w.item
WHERE NOT (
  r.ingredient_id IS (SELECT l.ingredient_id FROM catalog_goods_links l WHERE l.menu_id = w.item)
  AND (EXISTS (SELECT 1 FROM menu_item_ingredients x WHERE x.menu_item_id = w.item AND x.ingredient_id <> r.ingredient_id)
       OR EXISTS (SELECT 1 FROM menu_item_components y WHERE y.menu_item_id = w.item)))
GROUP BY w.root, r.ingredient_id;
