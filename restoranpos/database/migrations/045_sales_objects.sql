-- Satışlar (1.7.27): every closed bill is a sales invoice that can be looked
-- up, corrected or deleted (with permission), and people belong to a branch.
--
--   orders.closed_by      - who settled the bill (the waiter may differ).
--   orders.deleted_at/by  - a sale deleted from Satışlar: voided, its money
--                           and stock taken back, but the row kept for audit.
--   customers.object_id   - which branch (obyekt) a partner / employee is at.

ALTER TABLE orders ADD COLUMN closed_by TEXT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN deleted_at INTEGER;
ALTER TABLE orders ADD COLUMN deleted_by TEXT REFERENCES users(id);
ALTER TABLE customers ADD COLUMN object_id TEXT REFERENCES cash_objects(id);
CREATE INDEX IF NOT EXISTS idx_orders_closed_at ON orders(closed_at);
