-- Market POS 1.4: complete retail workflows. All money values are integer qepik.
PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN internal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN size TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN parent_product_id TEXT;

ALTER TABLE purchase_orders ADD COLUMN document_no TEXT;
ALTER TABLE purchase_orders ADD COLUMN updated_at INTEGER;
ALTER TABLE purchase_orders ADD COLUMN total_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';

ALTER TABLE sales ADD COLUMN loyalty_earned_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN loyalty_redeemed_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN credit_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE held_carts ADD COLUMN customer_id TEXT;

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0),
  returned_qty INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  UNIQUE(purchase_id, product_id)
);

INSERT OR IGNORE INTO purchase_order_lines(id, purchase_id, product_id, qty, cost_minor)
SELECT po.id || ':' || json_extract(line.value, '$.productId'), po.id,
       json_extract(line.value, '$.productId'),
       CAST(json_extract(line.value, '$.qty') AS INTEGER),
       CAST(COALESCE(json_extract(line.value, '$.costMinor'), 0) AS INTEGER)
FROM purchase_orders po, json_each(po.lines_json) AS line;

UPDATE purchase_orders
SET document_no = COALESCE(document_no, id),
    updated_at = COALESCE(updated_at, created_at),
    total_minor = COALESCE((SELECT SUM(qty * cost_minor) FROM purchase_order_lines l WHERE l.purchase_id = purchase_orders.id), 0);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_document_no_idx ON purchase_orders(document_no);
CREATE INDEX IF NOT EXISTS purchase_order_lines_purchase_idx ON purchase_order_lines(purchase_id);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY,
  return_no TEXT NOT NULL UNIQUE,
  purchase_id TEXT NOT NULL REFERENCES purchase_orders(id),
  supplier_name TEXT NOT NULL,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  purchase_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0)
);

CREATE TABLE IF NOT EXISTS employee_permission_overrides (
  employee_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(employee_id, permission)
);

CREATE TABLE IF NOT EXISTS treasury_transfers (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES cash_sessions(id),
  register_id TEXT NOT NULL REFERENCES registers(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  created_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS treasury_transfers_created_idx ON treasury_transfers(created_at);
CREATE INDEX IF NOT EXISTS purchase_returns_purchase_idx ON purchase_returns(purchase_id, created_at);
CREATE INDEX IF NOT EXISTS products_internal_code_idx ON products(internal_code);

INSERT OR IGNORE INTO settings(key, value) VALUES ('loyaltyRateBps', '0');
INSERT OR IGNORE INTO settings(key, value) VALUES ('loyaltyEnabled', 'false');
INSERT OR IGNORE INTO settings(key, value) VALUES ('backupRetentionDays', '30');

INSERT OR IGNORE INTO role_permissions(role, permission) VALUES
 ('manager', 'PURCHASE_EDIT'),
 ('manager', 'PURCHASE_RETURN'),
 ('manager', 'CUSTOMER_CREDIT'),
 ('manager', 'LOYALTY_REDEEM'),
 ('manager', 'CUSTOMER_DEBT'),
 ('manager', 'SUPPLIER_DEBT'),
 ('manager', 'MANAGE_PERMISSIONS'),
 ('manager', 'TREASURY_TRANSFER'),
 ('manager', 'BACKUP_MANAGE'),
 ('manager', 'PRINT_LABEL'),
 ('head_cashier', 'CUSTOMER_CREDIT'),
 ('head_cashier', 'LOYALTY_REDEEM'),
 ('head_cashier', 'CUSTOMER_DEBT'),
 ('warehouse', 'PURCHASE_RETURN'),
 ('warehouse', 'PRINT_LABEL');
