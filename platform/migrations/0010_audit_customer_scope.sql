-- Which restaurant a control-plane audit entry is about.
--
-- The only hint before this was the convention entity_type='customer' plus an
-- unindexed entity_id, so "everything that happened to this customer" was a
-- full table scan, and every entry filed under another entity (a licence, a
-- device, an activation key) was invisible to that question entirely.
--
-- Not a foreign key on purpose: the trail has to outlive the row it describes,
-- and customer.delete is the single entry an operator will most want to find.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS customer_id UUID;

-- Backfill what the old convention already recorded.
UPDATE audit_logs
   SET customer_id = entity_id::uuid
 WHERE customer_id IS NULL
   AND entity_type = 'customer'
   AND entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

CREATE INDEX IF NOT EXISTS audit_logs_customer_idx
  ON audit_logs (customer_id, created_at DESC);
