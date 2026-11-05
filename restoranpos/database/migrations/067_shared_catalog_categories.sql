-- Stable identity links, never name-based merges. Existing records and financial/recipe data stay put.
CREATE TABLE catalog_category_links (
 menu_category_id TEXT PRIMARY KEY REFERENCES menu_categories(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 stock_category_id TEXT NOT NULL UNIQUE REFERENCES stock_categories(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO catalog_category_links SELECT id,'mcat-'||lower(hex(randomblob(16))) FROM menu_categories;
INSERT INTO stock_categories(id,parent_id,name,sort_order,active,created_at)
 SELECT l.stock_category_id,p.stock_category_id,m.name_az,m.sort_order,m.active,0
 FROM menu_categories m JOIN catalog_category_links l ON l.menu_category_id=m.id
 LEFT JOIN catalog_category_links p ON p.menu_category_id=m.parent_id;
-- Preserve deeper warehouse trees; the restaurant supports a parent and one child level.
INSERT INTO catalog_category_links(menu_category_id,stock_category_id)
 SELECT 'scat-'||lower(hex(randomblob(16))),s.id FROM stock_categories s
 WHERE s.active=1 AND NOT EXISTS(SELECT 1 FROM catalog_category_links WHERE stock_category_id=s.id)
 AND (s.parent_id IS NULL OR EXISTS(SELECT 1 FROM stock_categories p WHERE p.id=s.parent_id AND p.parent_id IS NULL));
INSERT INTO menu_categories(id,parent_id,name_az,sort_order,active)
 SELECT l.menu_category_id,p.menu_category_id,s.name,s.sort_order,s.active
 FROM stock_categories s JOIN catalog_category_links l ON l.stock_category_id=s.id
 LEFT JOIN catalog_category_links p ON p.stock_category_id=s.parent_id
 WHERE NOT EXISTS(SELECT 1 FROM menu_categories WHERE id=l.menu_category_id);
UPDATE ingredients SET category_id=(
 SELECT c.stock_category_id FROM catalog_goods_links g JOIN menu_items m ON m.id=g.menu_id
 JOIN catalog_category_links c ON c.menu_category_id=m.category_id
 WHERE g.ingredient_id=ingredients.id ORDER BY m.id LIMIT 1)
 WHERE EXISTS(SELECT 1 FROM catalog_goods_links g JOIN menu_items m ON m.id=g.menu_id
 JOIN catalog_category_links c ON c.menu_category_id=m.category_id WHERE g.ingredient_id=ingredients.id)
 AND (SELECT COUNT(DISTINCT m.category_id) FROM catalog_goods_links g JOIN menu_items m ON m.id=g.menu_id WHERE g.ingredient_id=ingredients.id)=1;

CREATE TRIGGER catalog_category_menu_insert AFTER INSERT ON menu_categories
WHEN NOT EXISTS(SELECT 1 FROM catalog_category_links WHERE menu_category_id=NEW.id) BEGIN
 INSERT INTO catalog_category_links VALUES(NEW.id,'mcat-'||lower(hex(randomblob(16))));
 INSERT INTO stock_categories(id,parent_id,name,sort_order,active,created_at)
 SELECT l.stock_category_id,p.stock_category_id,NEW.name_az,NEW.sort_order,NEW.active,0
 FROM catalog_category_links l LEFT JOIN catalog_category_links p ON p.menu_category_id=NEW.parent_id WHERE l.menu_category_id=NEW.id;
END;
CREATE TRIGGER catalog_category_stock_insert AFTER INSERT ON stock_categories
WHEN NOT EXISTS(SELECT 1 FROM catalog_category_links WHERE stock_category_id=NEW.id)
 AND (NEW.parent_id IS NULL OR EXISTS(SELECT 1 FROM stock_categories p WHERE p.id=NEW.parent_id AND p.parent_id IS NULL)) BEGIN
 INSERT INTO catalog_category_links VALUES('scat-'||lower(hex(randomblob(16))),NEW.id);
 INSERT INTO menu_categories(id,parent_id,name_az,sort_order,active)
 SELECT l.menu_category_id,p.menu_category_id,NEW.name,NEW.sort_order,NEW.active
 FROM catalog_category_links l LEFT JOIN catalog_category_links p ON p.stock_category_id=NEW.parent_id WHERE l.stock_category_id=NEW.id;
END;
CREATE TRIGGER catalog_category_menu_update AFTER UPDATE OF name_az,parent_id,sort_order,active ON menu_categories BEGIN
 UPDATE stock_categories SET name=NEW.name_az,parent_id=(SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id=NEW.parent_id),sort_order=NEW.sort_order,active=NEW.active
 WHERE id=(SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id=NEW.id)
 AND (name IS NOT NEW.name_az OR parent_id IS NOT (SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id=NEW.parent_id) OR sort_order IS NOT NEW.sort_order OR active IS NOT NEW.active);
END;
CREATE TRIGGER catalog_category_stock_update AFTER UPDATE OF name,parent_id,sort_order,active ON stock_categories BEGIN
 UPDATE menu_categories SET name_az=NEW.name,parent_id=(SELECT menu_category_id FROM catalog_category_links WHERE stock_category_id=NEW.parent_id),sort_order=NEW.sort_order,active=NEW.active
 WHERE id=(SELECT menu_category_id FROM catalog_category_links WHERE stock_category_id=NEW.id)
 AND (name_az IS NOT NEW.name OR parent_id IS NOT (SELECT menu_category_id FROM catalog_category_links WHERE stock_category_id=NEW.parent_id) OR sort_order IS NOT NEW.sort_order OR active IS NOT NEW.active);
END;
CREATE TRIGGER catalog_category_depth_guard BEFORE UPDATE OF parent_id ON stock_categories
WHEN NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM catalog_category_links WHERE stock_category_id=NEW.id)
 AND (EXISTS(SELECT 1 FROM stock_categories WHERE id=NEW.parent_id AND parent_id IS NOT NULL) OR EXISTS(SELECT 1 FROM stock_categories WHERE parent_id=NEW.id AND active=1)) BEGIN
 SELECT RAISE(ABORT,'Restoranla bağlı kateqoriyada yalnız bir alt səviyyə ola bilər');
END;
CREATE TRIGGER catalog_category_stock_archive_guard BEFORE UPDATE OF active ON stock_categories
WHEN OLD.active=1 AND NEW.active=0 AND EXISTS(
 SELECT 1 FROM menu_items m JOIN catalog_category_links l ON l.menu_category_id=m.category_id WHERE l.stock_category_id=NEW.id AND m.active=1 AND m.archived=0) BEGIN
 SELECT RAISE(ABORT,'Əvvəl kateqoriyanın menyu məhsullarını köçürün və ya arxivləyin');
END;
CREATE TRIGGER catalog_category_menu_archive_guard BEFORE UPDATE OF active ON menu_categories
WHEN OLD.active=1 AND NEW.active=0 AND EXISTS(
 SELECT 1 FROM ingredients i JOIN catalog_category_links l ON l.stock_category_id=i.category_id WHERE l.menu_category_id=NEW.id AND i.active=1) BEGIN
 SELECT RAISE(ABORT,'Əvvəl kateqoriyanın anbar mallarını köçürün və ya arxivləyin');
END;
CREATE TRIGGER catalog_category_product_insert AFTER INSERT ON catalog_goods_links BEGIN
 UPDATE ingredients SET category_id=(SELECT c.stock_category_id FROM menu_items m JOIN catalog_category_links c ON c.menu_category_id=m.category_id WHERE m.id=NEW.menu_id)
 WHERE id=NEW.ingredient_id;
END;
CREATE TRIGGER catalog_category_product_move AFTER UPDATE OF category_id ON menu_items
WHEN NEW.category_id IS NOT OLD.category_id BEGIN
 UPDATE ingredients SET category_id=(SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id=NEW.category_id)
 WHERE id IN(SELECT ingredient_id FROM catalog_goods_links WHERE menu_id=NEW.id)
 AND category_id IS NOT (SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id=NEW.category_id);
END;
CREATE TRIGGER catalog_category_goods_move AFTER UPDATE OF category_id ON ingredients
WHEN NEW.category_id IS NOT OLD.category_id AND EXISTS(SELECT 1 FROM catalog_category_links WHERE stock_category_id=NEW.category_id) BEGIN
 UPDATE menu_items SET category_id=(SELECT menu_category_id FROM catalog_category_links WHERE stock_category_id=NEW.category_id),updated_at=NEW.updated_at
 WHERE id IN(SELECT menu_id FROM catalog_goods_links WHERE ingredient_id=NEW.id)
 AND category_id IS NOT (SELECT menu_category_id FROM catalog_category_links WHERE stock_category_id=NEW.category_id);
END;
