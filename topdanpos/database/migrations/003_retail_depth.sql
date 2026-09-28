-- Phase 3+: fiscal queue, terminal tx, refunds lines, stocktake, ledgers, promos, lots, sync stubs
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fiscal_queue (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  sale_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'refund')),
  provider TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'rejected')),
  request_json TEXT NOT NULL,
  response_json TEXT,
  payload_hash TEXT NOT NULL DEFAULT '',
  fiscal_receipt_id TEXT,
  qr_data TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS fiscal_queue_status_idx ON fiscal_queue(status, created_at);

CREATE TABLE IF NOT EXISTS terminal_transactions (
  id TEXT PRIMARY KEY,
  sale_id TEXT,
  terminal_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'manual',
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AZN',
  reference TEXT NOT NULL DEFAULT '',
  auth_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refund_lines (
  id TEXT PRIMARY KEY,
  refund_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  sale_item_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  amount_minor INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS refund_lines_sale_idx ON refund_lines(sale_id, sale_item_id);

CREATE TABLE IF NOT EXISTS stocktakes (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'counting', 'review', 'posted', 'canceled')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  posted_at INTEGER,
  posted_by TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stocktake_lines (
  id TEXT PRIMARY KEY,
  stocktake_id TEXT NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  expected_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER,
  difference_qty INTEGER,
  difference_value_minor INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  credit_allowed INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0,
  loyalty_card TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  balance_after_minor INTEGER NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS customer_ledger_idx ON customer_ledger(customer_id, created_at);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  balance_after_minor INTEGER NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS supplier_ledger_idx ON supplier_ledger(supplier_name, created_at);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  points_delta INTEGER NOT NULL,
  points_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER,
  ends_at INTEGER,
  priority INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS product_lots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  lot_number TEXT NOT NULL,
  produced_at INTEGER,
  expires_at INTEGER,
  qty_remaining INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL DEFAULT '',
  purchase_ref TEXT NOT NULL DEFAULT '',
  UNIQUE(product_id, warehouse_id, lot_number)
);

CREATE TABLE IF NOT EXISTS price_scopes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'branch', 'warehouse')),
  scope_id TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER
);

CREATE TABLE IF NOT EXISTS sync_meta (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'local',
  conflict_json TEXT,
  PRIMARY KEY (entity_type, entity_id)
);

ALTER TABLE sales ADD COLUMN customer_id TEXT;
ALTER TABLE sales ADD COLUMN payment_method_extra TEXT;
