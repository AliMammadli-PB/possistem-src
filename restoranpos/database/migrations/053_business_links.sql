-- Identity links preserve the original ledger/customer IDs.
ALTER TABLE customers ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE UNIQUE INDEX idx_customer_user ON customers(user_id) WHERE user_id IS NOT NULL;
UPDATE customers SET user_id=(SELECT u.id FROM users u WHERE u.full_name=customers.name)
WHERE kind='employee' AND (SELECT COUNT(*) FROM users u WHERE u.full_name=customers.name)=1
AND (SELECT COUNT(*) FROM customers c WHERE c.kind='employee' AND c.name=customers.name)=1;
INSERT INTO customers(id,name,kind,user_id,active,created_at,updated_at)
SELECT 'staff-'||u.id,u.full_name,'employee',u.id,u.active,u.created_at,u.updated_at FROM users u
WHERE NOT EXISTS(SELECT 1 FROM customers c WHERE c.user_id=u.id);
CREATE TRIGGER staff_partner_insert AFTER INSERT ON users BEGIN
 INSERT INTO customers(id,name,kind,user_id,active,created_at,updated_at)
 VALUES('staff-'||NEW.id,NEW.full_name,'employee',NEW.id,NEW.active,NEW.created_at,NEW.updated_at);
END;
CREATE TRIGGER staff_partner_update AFTER UPDATE OF full_name,active ON users BEGIN
 UPDATE customers SET name=NEW.full_name,active=NEW.active,updated_at=NEW.updated_at WHERE user_id=NEW.id;
END;
CREATE TRIGGER partner_staff_name AFTER UPDATE OF name ON customers WHEN NEW.user_id IS NOT NULL AND NEW.name!=OLD.name BEGIN
 UPDATE users SET full_name=NEW.name,updated_at=NEW.updated_at WHERE id=NEW.user_id;
END;
CREATE TABLE user_warehouse_access(
 user_id TEXT NOT NULL REFERENCES users(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
 PRIMARY KEY(user_id,warehouse_id)
);
-- Exact links, rather than trying to identify payments later by their amounts.
CREATE TABLE document_cash_links(
 doc_type TEXT NOT NULL,doc_id TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',
 cash_movement_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(doc_type,doc_id)
);
-- Recover only unambiguous old links. Ambiguous history must never debit a guessed till.
INSERT INTO document_cash_links(doc_type,doc_id,account_id)
SELECT 'customer',l.id,MIN(m.account_id) FROM customer_ledger l JOIN cash_account_moves m
 ON m.ref_type='customer' AND m.ref_id=l.customer_id AND m.amount_minor=l.amount_minor
 AND m.created_at=l.created_at WHERE l.kind='payment' GROUP BY l.id HAVING COUNT(*)=1;
INSERT INTO document_cash_links(doc_type,doc_id,account_id)
SELECT 'supplier',l.id,MIN(m.account_id) FROM supplier_ledger l JOIN cash_account_moves m
 ON m.ref_type='supplier' AND m.ref_id=l.supplier_id AND m.amount_minor=-l.amount_minor
 AND m.created_at=l.created_at WHERE l.kind='payment' GROUP BY l.id HAVING COUNT(*)=1;
-- Historic writes used separate clock reads for the document and its cash move.
-- Recover a pair only if BOTH sides have exactly one candidate in the small window.
INSERT OR IGNORE INTO document_cash_links(doc_type,doc_id,account_id)
SELECT 'customer',l.id,m.account_id FROM customer_ledger l JOIN cash_account_moves m
 ON m.ref_type='customer' AND m.ref_id=l.customer_id AND m.amount_minor=l.amount_minor
 AND m.created_at BETWEEN l.created_at AND l.created_at+5000
WHERE l.kind='payment'
 AND (SELECT COUNT(*) FROM cash_account_moves x WHERE x.ref_type='customer' AND x.ref_id=l.customer_id AND x.amount_minor=l.amount_minor AND x.created_at BETWEEN l.created_at AND l.created_at+5000)=1
 AND (SELECT COUNT(*) FROM customer_ledger x WHERE x.kind='payment' AND x.customer_id=l.customer_id AND x.amount_minor=l.amount_minor AND m.created_at BETWEEN x.created_at AND x.created_at+5000)=1;
INSERT OR IGNORE INTO document_cash_links(doc_type,doc_id,account_id)
SELECT 'supplier',l.id,m.account_id FROM supplier_ledger l JOIN cash_account_moves m
 ON m.ref_type='supplier' AND m.ref_id=l.supplier_id AND m.amount_minor=-l.amount_minor
 AND m.created_at BETWEEN l.created_at AND l.created_at+5000
WHERE l.kind='payment'
 AND (SELECT COUNT(*) FROM cash_account_moves x WHERE x.ref_type='supplier' AND x.ref_id=l.supplier_id AND x.amount_minor=-l.amount_minor AND x.created_at BETWEEN l.created_at AND l.created_at+5000)=1
 AND (SELECT COUNT(*) FROM supplier_ledger x WHERE x.kind='payment' AND x.supplier_id=l.supplier_id AND x.amount_minor=l.amount_minor AND m.created_at BETWEEN x.created_at AND x.created_at+5000)=1;
-- Shared catalogue metadata. Recipes remain separate from saleable goods.
CREATE TRIGGER menu_goods_update AFTER UPDATE OF name_az,price_minor ON menu_items BEGIN
 UPDATE ingredients SET name=NEW.name_az,sale_price_minor=NEW.price_minor,updated_at=NEW.updated_at
 WHERE sku='MENU-'||NEW.id AND (name!=NEW.name_az OR sale_price_minor!=NEW.price_minor);
END;
CREATE TRIGGER goods_menu_update AFTER UPDATE OF name,sale_price_minor ON ingredients WHEN NEW.sku LIKE 'MENU-%' BEGIN
 UPDATE menu_items SET name_az=NEW.name,updated_at=NEW.updated_at
 WHERE id=substr(NEW.sku,6) AND name_az!=NEW.name;
END;

ALTER TABLE delivery_orders ADD COLUMN terminal_id TEXT NOT NULL DEFAULT '';
CREATE TRIGGER delivery_terminal AFTER INSERT ON delivery_orders WHEN NEW.terminal_id='' BEGIN
 UPDATE delivery_orders SET terminal_id=COALESCE((SELECT value FROM app_settings WHERE key='terminal.id'),'') WHERE id=NEW.id;
END;

CREATE TABLE catalog_goods_links(
 menu_id TEXT PRIMARY KEY REFERENCES menu_items(id),
 ingredient_id TEXT NOT NULL UNIQUE REFERENCES ingredients(id)
);
INSERT OR IGNORE INTO catalog_goods_links(menu_id,ingredient_id)
SELECT m.id,i.id FROM menu_items m JOIN ingredients i ON i.sku='MENU-'||m.id;
CREATE TRIGGER catalog_goods_insert AFTER INSERT ON ingredients WHEN NEW.sku LIKE 'MENU-%' BEGIN
 INSERT OR IGNORE INTO catalog_goods_links(menu_id,ingredient_id)
 SELECT id,NEW.id FROM menu_items WHERE id=substr(NEW.sku,6);
END;
CREATE TRIGGER catalog_link_menu AFTER UPDATE OF name_az,price_minor ON menu_items BEGIN
 UPDATE ingredients SET name=NEW.name_az,sale_price_minor=NEW.price_minor,updated_at=NEW.updated_at
 WHERE id IN(SELECT ingredient_id FROM catalog_goods_links WHERE menu_id=NEW.id)
 AND (name!=NEW.name_az OR sale_price_minor!=NEW.price_minor);
END;
CREATE TRIGGER catalog_link_goods AFTER UPDATE OF name,sale_price_minor ON ingredients BEGIN
 INSERT INTO menu_item_price_history(id,item_id,old_price_minor,new_price_minor,reason,created_at)
 SELECT lower(hex(randomblob(16))),m.id,m.price_minor,NEW.sale_price_minor,'Vahid kataloq',NEW.updated_at
 FROM menu_items m JOIN catalog_goods_links l ON l.menu_id=m.id
 WHERE l.ingredient_id=NEW.id AND m.price_minor!=NEW.sale_price_minor;
 UPDATE menu_items SET name_az=NEW.name,price_minor=NEW.sale_price_minor,updated_at=NEW.updated_at
 WHERE id IN(SELECT menu_id FROM catalog_goods_links WHERE ingredient_id=NEW.id)
 AND (name_az!=NEW.name OR price_minor!=NEW.sale_price_minor);
END;
ALTER TABLE cash_movements ADD COLUMN deleted_at INTEGER;
