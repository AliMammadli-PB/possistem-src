-- Phase 1: cashier ops — permissions, cash movements, X/Z, holds metadata, price override, stock policy
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  register_id TEXT NOT NULL REFERENCES registers(id),
  type TEXT NOT NULL CHECK (type IN ('cash_in', 'cash_out', 'safe_drop')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  approver_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON cash_movements(session_id, created_at);

ALTER TABLE cash_sessions ADD COLUMN expected_cash_minor INTEGER;
ALTER TABLE cash_sessions ADD COLUMN actual_cash_minor INTEGER;
ALTER TABLE cash_sessions ADD COLUMN difference_minor INTEGER;
ALTER TABLE cash_sessions ADD COLUMN z_report_json TEXT;

CREATE TABLE IF NOT EXISTS z_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES cash_sessions(id),
  register_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

ALTER TABLE held_carts ADD COLUMN cashier_id TEXT NOT NULL DEFAULT '';
ALTER TABLE held_carts ADD COLUMN register_id TEXT NOT NULL DEFAULT '';
ALTER TABLE held_carts ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE held_carts ADD COLUMN customer_name TEXT;
ALTER TABLE held_carts ADD COLUMN note TEXT;

ALTER TABLE sale_items ADD COLUMN original_unit_price_minor INTEGER;
ALTER TABLE sale_items ADD COLUMN override_reason TEXT;
ALTER TABLE sale_items ADD COLUMN override_actor_id TEXT;
ALTER TABLE sale_items ADD COLUMN override_approver_id TEXT;

ALTER TABLE sales ADD COLUMN session_id TEXT;
ALTER TABLE sales ADD COLUMN fiscal_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE sales ADD COLUMN terminal_ref TEXT;

CREATE TABLE IF NOT EXISTS product_barcodes (
  barcode TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS product_barcodes_product_idx ON product_barcodes(product_id);

ALTER TABLE products ADD COLUMN plu TEXT;
ALTER TABLE products ADD COLUMN track_lot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN target_stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN reorder_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN preferred_supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN avg_cost_minor INTEGER;

-- Default stock policy + scale barcode rules stored in settings via seed inserts
INSERT OR IGNORE INTO settings(key, value) VALUES ('stockPolicy', '"BLOCK_NEGATIVE_STOCK"');
INSERT OR IGNORE INTO settings(key, value) VALUES ('scannerConfig', '{"enterSuffix":true,"duplicateIncrements":true,"minLength":6}');
INSERT OR IGNORE INTO settings(key, value) VALUES ('scaleBarcodeRules', '[{"prefix":"20","pluStart":2,"pluLen":5,"valueStart":7,"valueLen":5,"decimals":3,"mode":"WEIGHT","checkChecksum":true}]');
INSERT OR IGNORE INTO settings(key, value) VALUES ('terminalMode', '"manual"');
INSERT OR IGNORE INTO settings(key, value) VALUES ('printerConfig', '{"widthMm":80,"cut":true,"openDrawerOnCash":true}');

-- Seed role permissions
INSERT OR IGNORE INTO role_permissions(role, permission) VALUES
 ('manager', 'SALE_DISCOUNT'),
 ('manager', 'SALE_CANCEL'),
 ('manager', 'SALE_REFUND'),
 ('manager', 'PARTIAL_REFUND'),
 ('manager', 'PRICE_OVERRIDE'),
 ('manager', 'OPEN_DRAWER'),
 ('manager', 'CASH_IN'),
 ('manager', 'CASH_OUT'),
 ('manager', 'SAFE_DROP'),
 ('manager', 'EDIT_PRODUCT'),
 ('manager', 'CREATE_PRODUCT'),
 ('manager', 'EDIT_PRICE'),
 ('manager', 'VIEW_COST'),
 ('manager', 'EDIT_STOCK'),
 ('manager', 'STOCK_ADJUSTMENT'),
 ('manager', 'RECEIVE_PURCHASE'),
 ('manager', 'TRANSFER_STOCK'),
 ('manager', 'CLOSE_SHIFT'),
 ('manager', 'VIEW_REPORTS'),
 ('manager', 'VIEW_PROFIT'),
 ('manager', 'MANAGE_USERS'),
 ('manager', 'MANAGE_SETTINGS'),
 ('manager', 'HOLD_CANCEL'),
 ('head_cashier', 'SALE_DISCOUNT'),
 ('head_cashier', 'SALE_CANCEL'),
 ('head_cashier', 'SALE_REFUND'),
 ('head_cashier', 'PARTIAL_REFUND'),
 ('head_cashier', 'PRICE_OVERRIDE'),
 ('head_cashier', 'OPEN_DRAWER'),
 ('head_cashier', 'CASH_IN'),
 ('head_cashier', 'CASH_OUT'),
 ('head_cashier', 'SAFE_DROP'),
 ('head_cashier', 'CLOSE_SHIFT'),
 ('head_cashier', 'VIEW_REPORTS'),
 ('head_cashier', 'HOLD_CANCEL'),
 ('cashier', 'SALE_DISCOUNT'),
 ('cashier', 'OPEN_DRAWER'),
 ('warehouse', 'EDIT_PRODUCT'),
 ('warehouse', 'CREATE_PRODUCT'),
 ('warehouse', 'EDIT_STOCK'),
 ('warehouse', 'STOCK_ADJUSTMENT'),
 ('warehouse', 'RECEIVE_PURCHASE'),
 ('warehouse', 'TRANSFER_STOCK'),
 ('warehouse', 'VIEW_COST'),
 ('warehouse', 'VIEW_REPORTS');
