-- Market POS initial schema. Money is INTEGER qəpik (int64). Never REAL.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS database_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  manager TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL,
  name_az TEXT NOT NULL,
  name_ru TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'əd',
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0,
  tax_rate INTEGER NOT NULL DEFAULT 18,
  supplier TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#2563eb',
  image_json TEXT NOT NULL DEFAULT '{"kind":"sprite","index":0}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE INDEX IF NOT EXISTS products_active_idx ON products(active);

CREATE TABLE IF NOT EXISTS stock_levels (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  type TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty_delta INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS stock_movements_ref_idx ON stock_movements(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS registers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
  operator_id TEXT,
  opening_float_minor INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES registers(id),
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  operator_id TEXT NOT NULL,
  opening_float_minor INTEGER NOT NULL DEFAULT 0,
  closing_float_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_amount_minor INTEGER NOT NULL,
  tendered_minor INTEGER NOT NULL,
  change_minor INTEGER NOT NULL DEFAULT 0,
  cash_minor INTEGER,
  card_minor INTEGER,
  refunded INTEGER NOT NULL DEFAULT 0,
  cashier_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  customer_name TEXT,
  note TEXT,
  warehouse_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sales_created_idx ON sales(created_at);
CREATE INDEX IF NOT EXISTS sales_receipt_idx ON sales(receipt_no);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS draft_sales (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  cashier_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS held_carts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  lines_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  supplier TEXT NOT NULL,
  expected_at TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('draft', 'ordered', 'received')),
  lines_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs are append-only');
END;
