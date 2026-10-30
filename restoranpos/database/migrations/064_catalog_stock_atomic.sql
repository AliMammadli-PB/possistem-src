-- Repair the old best-effort Catalog -> Anbar follow-up. Do not touch stock
-- quantities/costs, archived goods, existing recipes or goods linked elsewhere.
INSERT OR IGNORE INTO catalog_goods_links(menu_id,ingredient_id)
SELECT m.id,i.id FROM menu_items m JOIN ingredients i
 ON i.active=1 AND i.unit='ədəd' AND i.barcode=m.barcode AND m.barcode!=''
WHERE m.archived=0
 AND NOT EXISTS(SELECT 1 FROM catalog_goods_links l WHERE l.menu_id=m.id OR l.ingredient_id=i.id)
 AND NOT EXISTS(SELECT 1 FROM menu_item_ingredients r WHERE r.menu_item_id=m.id);

CREATE TEMP TABLE _catalog_stock_repair AS
SELECT m.id AS menu_id,'ing-menu-'||m.id AS ingredient_id,m.name_az AS name,
 COALESCE(m.barcode,'') AS barcode,m.price_minor,m.updated_at
FROM menu_items m WHERE m.archived=0
 AND NOT EXISTS(SELECT 1 FROM menu_item_ingredients r WHERE r.menu_item_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM catalog_goods_links l WHERE l.menu_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM ingredients i WHERE i.sku='MENU-'||m.id)
 AND NOT EXISTS(SELECT 1 FROM ingredients i WHERE m.barcode!='' AND i.barcode=m.barcode);
INSERT INTO ingredients(id,sku,name,unit,cost_minor,avg_cost_minor,min_qty_milli,barcode,sale_price_minor,created_at,updated_at)
SELECT ingredient_id,'MENU-'||menu_id,name,'ədəd',0,0,0,barcode,price_minor,updated_at,updated_at
FROM _catalog_stock_repair;
INSERT OR IGNORE INTO catalog_goods_links(menu_id,ingredient_id)
SELECT m.id,i.id FROM menu_items m JOIN ingredients i ON i.sku='MENU-'||m.id;
INSERT INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli)
SELECT l.menu_id,l.ingredient_id,1000 FROM catalog_goods_links l
 JOIN menu_items m ON m.id=l.menu_id JOIN ingredients i ON i.id=l.ingredient_id
WHERE m.archived=0 AND i.active=1
 AND NOT EXISTS(SELECT 1 FROM menu_item_ingredients r WHERE r.menu_item_id=l.menu_id);
DROP TABLE _catalog_stock_repair;
