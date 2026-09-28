/**
 * AUTO-GENERATED from market-pos/database/migrations - DO NOT EDIT.
 * Regenerate with: node scripts/gen-market-migrations.mjs
 */
#pragma once
#include <cstddef>
#include <string_view>
namespace market::db {
inline constexpr int kSchemaVersion = 13;
struct EmbeddedMigration { int version; const char* name; const char* checksum; std::string_view sql; };
inline constexpr EmbeddedMigration kMigrations[] = {
  {1, "001_initial_schema.sql", "16074141", R"market(-- Market POS initial schema. Money is INTEGER qəpik (int64). Never REAL.
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
)market"},
  {2, "002_cashier_ops.sql", "14cd99e6", R"market(-- Phase 1: cashier ops — permissions, cash movements, X/Z, holds metadata, price override, stock policy
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
)market"},
  {3, "003_retail_depth.sql", "85057430", R"market(-- Phase 3+: fiscal queue, terminal tx, refunds lines, stocktake, ledgers, promos, lots, sync stubs
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
)market"},
  {4, "004_market_140.sql", "be2a5510", R"market(-- Market POS 1.4: complete retail workflows. All money values are integer qepik.
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
)market"},
  {5, "005_market_sync.sql", "086f6064", R"market(-- Market POS shared inventory: durable event outbox and peer vectors.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_events (
  event_id TEXT PRIMARY KEY,
  origin_device_id TEXT NOT NULL,
  origin_seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  server_acked INTEGER NOT NULL DEFAULT 0 CHECK (server_acked IN (0, 1)),
  UNIQUE(origin_device_id, origin_seq)
);

CREATE TABLE IF NOT EXISTS sync_vectors (
  origin_device_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_peers (
  device_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol_version INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_catalog_clock (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  logical_at INTEGER NOT NULL,
  origin_device_id TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS sync_events_created_idx ON sync_events(created_at);
CREATE INDEX IF NOT EXISTS sync_events_pending_idx ON sync_events(server_acked, created_at);

INSERT OR IGNORE INTO settings(key, value) VALUES ('syncDeviceId', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('syncBootstrapDone', 'false');
)market"},
  {6, "006_sync_resilience.sql", "9486b96d", R"market(-- Sync resilience: dead-letter quarantine, pre-activation parking, peer cursors
-- and the index that makes the peer-filtered export actually selective.
PRAGMA foreign_keys = ON;

-- Inbound events we could not apply. Quarantined rather than retried forever, so
-- one unapplicable event cannot stall the whole replication stream.
CREATE TABLE IF NOT EXISTS sync_events_dead (
  event_id TEXT PRIMARY KEY,
  origin_device_id TEXT NOT NULL,
  origin_seq INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT ''
);

-- Events produced before sync.configure assigned this device an identity. Without
-- this they were dropped on the floor and never replicated.
CREATE TABLE IF NOT EXISTS sync_events_orphan (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Durable per-peer cursors. Previously peer progress lived only in the Electron
-- process, so a restart re-sent the entire outbox and retention could never tell
-- which events were safe to drop.
CREATE TABLE IF NOT EXISTS sync_peer_vectors (
  peer_device_id TEXT NOT NULL,
  origin_device_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(peer_device_id, origin_device_id)
);

-- The export filters on (origin_device_id, origin_seq); without this index that
-- filter degrades to a scan of the whole outbox on every 2s cycle.
CREATE INDEX IF NOT EXISTS sync_events_origin_seq_idx ON sync_events(origin_device_id, origin_seq);
CREATE INDEX IF NOT EXISTS sync_events_dead_failed_idx ON sync_events_dead(failed_at);

INSERT OR IGNORE INTO settings(key, value) VALUES ('syncRetentionDays', '30');
)market"},
  {7, "007_single_stock.sql", "499d781e", R"market(-- Single-stock model: collapse every warehouse into one.
--
-- Two faults are repaired here.
--
-- 1. `settings.defaultWarehouseId` could name a warehouse that does not exist.
--    The seed ships 'wh-sales', but a shop that creates its own warehouses
--    never gets that row and nothing ever rewrites the setting. Because
--    stock_levels.warehouse_id carries a real FK and foreign_keys is ON, this
--    does not merely display 0 — every sale fails on SQLITE_CONSTRAINT and
--    rolls back, so the till cannot trade at all.
--
-- 2. Stock was split across warehouses while the register read exactly one of
--    them, so quantity typed into the wrong field was invisible at the till.
--
-- Deliberately minimal: the runtime resolver in Warehouse.cpp handles anything
-- this cannot, and a migration that throws would brick startup.
--
-- Not done here, on purpose:
--   * no warehouse is created when the table is empty — a fresh install adopts
--     whichever warehouse it is later given
--   * `warehouses` rows are never deleted — stock_levels.warehouse_id cascades
--   * `product_lots` is left alone — UNIQUE(product_id, warehouse_id,
--     lot_number) makes the same lot number in two warehouses legal today, so
--     repointing it can collide
PRAGMA foreign_keys = ON;

-- The surviving warehouse: the configured one when it is real, else the seeded
-- sales floor, else the lowest id so every till picks deterministically.
CREATE TEMP TABLE _wh_pick AS
SELECT COALESCE(
  (SELECT w.id FROM warehouses w
     JOIN settings s ON s.key = 'defaultWarehouseId' AND s.value = w.id
    LIMIT 1),
  (SELECT id FROM warehouses WHERE id = 'wh-sales' LIMIT 1),
  (SELECT id FROM warehouses ORDER BY id LIMIT 1)
) AS id;

-- Delete-then-insert because SQLite cannot UPDATE a row onto an existing
-- primary key, and (product_id, warehouse_id) is that key.
CREATE TEMP TABLE _collapsed AS
SELECT product_id, SUM(qty) AS qty FROM stock_levels GROUP BY product_id;

DELETE FROM stock_levels WHERE (SELECT id FROM _wh_pick) IS NOT NULL;

INSERT INTO stock_levels (product_id, warehouse_id, qty)
SELECT c.product_id, (SELECT id FROM _wh_pick), c.qty
FROM _collapsed c
WHERE (SELECT id FROM _wh_pick) IS NOT NULL;

INSERT INTO settings (key, value)
SELECT 'defaultWarehouseId', id FROM _wh_pick WHERE id IS NOT NULL
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- The replication clock keyed stock as "<productId>@<warehouseId>". With one
-- warehouse the suffix only stops two tills from arbitrating the same product,
-- so re-key to the bare product id and keep the newest clock per product.
CREATE TEMP TABLE _stock_clock AS
SELECT
  substr(entity_id, 1, instr(entity_id, '@') - 1) AS product_id,
  MAX(logical_at) AS logical_at
FROM sync_catalog_clock
WHERE entity_type = 'stock' AND instr(entity_id, '@') > 0
GROUP BY 1;

DELETE FROM sync_catalog_clock WHERE entity_type = 'stock';

INSERT INTO sync_catalog_clock (entity_type, entity_id, logical_at, origin_device_id)
SELECT 'stock', c.product_id, c.logical_at, ''
FROM _stock_clock c
WHERE c.product_id <> '';

DROP TABLE _stock_clock;
DROP TABLE _collapsed;
DROP TABLE _wh_pick;
)market"},
  {8, "008_loyalty_foundations.sql", "5e2bf1bf", R"market(-- Bonus (loyalty) card foundations.
--
-- The earn/redeem money path already worked, but nothing around it did: a card
-- could not be scanned, the default rate made every sale earn zero, the cashier
-- standing at the till was the one role not allowed to redeem, and the balance
-- query had no index behind it. This migration fixes the data layer for all four.

-- A bonus card must identify exactly one customer. Without this a scanned card
-- could match two rows and credit the wrong person's balance; the column has
-- carried no constraint since it was introduced.
CREATE UNIQUE INDEX IF NOT EXISTS customers_loyalty_card_idx
  ON customers(loyalty_card)
  WHERE loyalty_card IS NOT NULL AND loyalty_card <> '';

-- Every balance read is "newest ledger row for this customer". customer_ledger
-- got that index; loyalty_ledger was left to scan the whole table on each sale.
CREATE INDEX IF NOT EXISTS loyalty_ledger_customer_idx
  ON loyalty_ledger(customer_id, created_at);

-- Redemption was granted to manager and head_cashier only, so the person who
-- actually serves the customer could never apply their bonus — and the sale
-- screen has no manager-approval flow to escalate through. A cashier taking
-- bonus off a total is ordinary counter work, not a privileged override.
INSERT OR IGNORE INTO role_permissions(role, permission) VALUES ('cashier', 'LOYALTY_REDEEM');

-- Ship 1% rather than 0%. The control plane already provisions new customers at
-- 1.00% and overwrites this on every heartbeat, so the old '0' only ever applied
-- before the first heartbeat — and on trial tills, which never heartbeat, it
-- meant the bonus feature silently never worked at all.
UPDATE settings SET value = '100' WHERE key = 'loyaltyRateBps' AND value = '0';

-- `loyaltyEnabled` was seeded but never read by a single line of code; the till
-- derives "enabled" from the rate being above zero. Drop the dead switch so it
-- cannot be mistaken for a working toggle.
DELETE FROM settings WHERE key = 'loyaltyEnabled';
)market"},
  {9, "009_role_catalogue.sql", "7f784ceb", R"market(-- A name and a description for every permission, so the roles screen can show
-- something an operator understands instead of SALE_REFUND.
--
-- The grants themselves already live in role_permissions; this only describes
-- the keys. `custom` marks roles an operator created, so the shipped three keep
-- their guarantees.
CREATE TABLE IF NOT EXISTS permission_catalogue (
  permission TEXT PRIMARY KEY,
  grp        TEXT NOT NULL DEFAULT 'other',
  label      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roles (
  role        TEXT PRIMARY KEY,
  label       TEXT NOT NULL DEFAULT '',
  custom      INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0,1))
);

INSERT OR IGNORE INTO roles(role, label, custom) VALUES
  ('manager',   'Müdir',   0),
  ('cashier',   'Kassir',  0),
  ('warehouse', 'Anbardar',0);

INSERT OR IGNORE INTO permission_catalogue(permission, grp, label) VALUES
  ('SALE_DISCOUNT',    'satis',    'Endirim tətbiq etmək'),
  ('SALE_CANCEL',      'satis',    'Satışı ləğv etmək'),
  ('SALE_REFUND',      'satis',    'Geri qaytarma'),
  ('PARTIAL_REFUND',   'satis',    'Qismən geri qaytarma'),
  ('PRICE_OVERRIDE',   'satis',    'Qiyməti dəyişmək'),
  ('HOLD_CANCEL',      'satis',    'Gözləyən satışı ləğv etmək'),
  ('OPEN_DRAWER',      'kassa',    'Kassa şüşəsini açmaq'),
  ('CASH_IN',          'kassa',    'Kassaya pul girişi'),
  ('CASH_OUT',         'kassa',    'Kassadan pul çıxışı'),
  ('SAFE_DROP',        'kassa',    'Seyfə köçürmə'),
  ('CLOSE_SHIFT',      'kassa',    'Növbəni bağlamaq'),
  ('CREATE_PRODUCT',   'menyu',    'Məhsul yaratmaq'),
  ('EDIT_PRODUCT',     'menyu',    'Məhsulu redaktə etmək'),
  ('EDIT_PRICE',       'menyu',    'Qiyməti dəyişmək'),
  ('VIEW_COST',        'menyu',    'Maya dəyərini görmək'),
  ('EDIT_STOCK',       'anbar',    'Stoku dəyişmək'),
  ('STOCK_ADJUSTMENT', 'anbar',    'Stok düzəlişi'),
  ('RECEIVE_PURCHASE', 'anbar',    'Mal qəbulu'),
  ('TRANSFER_STOCK',   'anbar',    'Anbarlararası transfer'),
  ('VIEW_REPORTS',     'hesabat',  'Hesabatlara baxmaq'),
  ('VIEW_PROFIT',      'hesabat',  'Mənfəəti görmək'),
  ('MANAGE_USERS',     'sistem',   'İstifadəçiləri idarə etmək'),
  ('MANAGE_SETTINGS',  'sistem',   'Tənzimləmələri dəyişmək'),
  ('MANAGE_ROLES',     'sistem',   'Rol və səlahiyyətləri idarə etmək');

-- The manager holds every permission there is, including any added later:
-- without this, granting a right the manager lacked would leave nobody able to
-- take it back.
INSERT OR IGNORE INTO role_permissions(role, permission)
SELECT 'manager', permission FROM permission_catalogue;
)market"},
  {10, "010_delivery_recipes_roster.sql", "82cdea5f", R"market(-- The three things a market POS was missing: orders that leave the shop,
-- recipes for anything made in-house, and a roster to plan staff against.

-- ------------------------------------------------------------------ delivery
CREATE TABLE IF NOT EXISTS couriers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  user_id    TEXT,
  vehicle    TEXT NOT NULL DEFAULT '' CHECK (vehicle IN ('','walk','bike','moto','car')),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL
);

-- A delivery is a sale with a destination, not a different kind of sale: it
-- points at the sale so revenue and stock stay in one place.
CREATE TABLE IF NOT EXISTS delivery_orders (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL UNIQUE,
  customer_id  TEXT,
  courier_id   TEXT REFERENCES couriers(id),
  address      TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  fee_minor    INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','assigned','picked_up','delivered','failed','cancelled')),
  assigned_at  INTEGER,
  delivered_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_delivery_status ON delivery_orders(status, created_at);

CREATE TABLE IF NOT EXISTS delivery_events (
  id          TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  courier_id  TEXT,
  note        TEXT NOT NULL DEFAULT '',
  actor_id    TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- ------------------------------------------------------------------- recipes
-- What one unit of a made-up product consumes: a deli tray, a coffee, a bakery
-- item. Quantities are thousandths, so 0.333 kg three times is exactly 0.999.
CREATE TABLE IF NOT EXISTS product_recipes (
  product_id    TEXT NOT NULL,
  component_id  TEXT NOT NULL,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  PRIMARY KEY (product_id, component_id),
  CHECK (product_id != component_id)
);

-- -------------------------------------------------------------------- roster
CREATE TABLE IF NOT EXISTS staff_schedules (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  role_note   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','confirmed','cancelled')),
  created_at  INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_market_schedule ON staff_schedules(user_id, starts_at);

CREATE TABLE IF NOT EXISTS attendance (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  schedule_id  TEXT REFERENCES staff_schedules(id),
  clock_in_at  INTEGER NOT NULL,
  clock_out_at INTEGER,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

-- One open punch per person: clocking in twice is a mistake, not a second shift.
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_attendance_open
  ON attendance(user_id) WHERE clock_out_at IS NULL;

INSERT OR IGNORE INTO permission_catalogue(permission, grp, label) VALUES
  ('DELIVERY_VIEW',   'catdirilma', 'Çatdırılmaları görmək'),
  ('DELIVERY_MANAGE', 'catdirilma', 'Çatdırılma və kuryer idarəsi'),
  ('DELIVERY_ASSIGN', 'catdirilma', 'Kuryer təyin etmək'),
  ('EDIT_RECIPE',     'menyu',      'Resept redaktə etmək'),
  ('SCHEDULE_VIEW',   'sistem',     'İş qrafikinə baxmaq'),
  ('SCHEDULE_MANAGE', 'sistem',     'İş qrafikini planlamaq'),
  ('SCHEDULE_CLOCK',  'sistem',     'İşə giriş/çıxış qeyd etmək');

INSERT OR IGNORE INTO role_permissions(role, permission) VALUES
  ('cashier',   'DELIVERY_VIEW'),   ('cashier',   'DELIVERY_ASSIGN'),
  ('cashier',   'SCHEDULE_VIEW'),   ('cashier',   'SCHEDULE_CLOCK'),
  ('warehouse', 'DELIVERY_VIEW'),   ('warehouse', 'EDIT_RECIPE'),
  ('warehouse', 'SCHEDULE_VIEW'),   ('warehouse', 'SCHEDULE_CLOCK');

-- The manager holds every permission there is, including the ones just added.
INSERT OR IGNORE INTO role_permissions(role, permission)
SELECT 'manager', permission FROM permission_catalogue;
)market"},
  {11, "011_pharmacy.sql", "01706eba", R"market(-- Topdan POS 1.0: medicine attributes. Additive only.
--   inn            active ingredient (international non-proprietary name)
--   strength       "500 mg", "5 mg/ml"
--   dosage_form    tablet, capsule, syrup, ... (see src/pharmacy.ts)
--   pack_units     units in one pack (20 tablets); stock of a split product is in units
--   split_allowed  1 = a pack may be opened and sold by the unit
--   rx_required    1 = prescription only
--   storage        room / cool (2-8 °C) / frozen
ALTER TABLE products ADD COLUMN inn TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN strength TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN dosage_form TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN pack_units INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN split_allowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN rx_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN storage TEXT NOT NULL DEFAULT 'room';
ALTER TABLE products ADD COLUMN manufacturer TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN reg_no TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_inn ON products(inn);
CREATE INDEX IF NOT EXISTS idx_lots_product_expiry ON product_lots(product_id, expires_at);
)market"},
  {12, "012_shelves.sql", "0e3b122b", R"market(-- Topdan POS 1.1: shelves. Every medicine can name the shelf it sits on, so a
-- pharmacist finds a box without searching the room. Additive only.
CREATE TABLE IF NOT EXISTS shelves (
  code TEXT PRIMARY KEY,
  zone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE products ADD COLUMN shelf TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_shelf ON products(shelf);
)market"},
  {13, "013_wholesale.sql", "41e2b68a", R"market(-- Topdan POS (wholesale): three price levels per product, the pack a product
-- ships in (qutu, yeşik, blok…), and wholesale customers with a price level,
-- tax id (VÖEN) and address for the invoice. Additive only.
ALTER TABLE products ADD COLUMN price_wholesale_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN price_dealer_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN pack_name TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN price_tier TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE customers ADD COLUMN voen TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN note TEXT NOT NULL DEFAULT '';
)market"},
};
inline constexpr std::size_t kMigrationCount = 13;
struct EmbeddedSeed { const char* name; std::string_view sql; };
inline constexpr EmbeddedSeed kSeeds[] = {
};
inline constexpr std::size_t kSeedCount = 0;
}  // namespace market::db
