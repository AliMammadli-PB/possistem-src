-- Shop order tracking for the customer: an estimated delivery / pickup time set by
-- the admin, and the structured delivery address (the composed text stays in
-- delivery_address for existing screens). billing_orders.note is shown to the customer.
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS estimated_at timestamptz;
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS delivery_details jsonb NOT NULL DEFAULT '{}'::jsonb;
