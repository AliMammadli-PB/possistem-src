-- Server-origin catalog events (owner web writing products) cannot use a real
-- device UUID as origin_device_id. Drop the devices FK so the well-known
-- server origin can enqueue product.upsert / stock.snapshot for tills to pull.
-- Also queue remote X/Z report commands from possistem.az/marketpos to a till.

ALTER TABLE market_sync_events
  DROP CONSTRAINT IF EXISTS market_sync_events_origin_device_id_fkey;

ALTER TABLE market_products
  DROP CONSTRAINT IF EXISTS market_products_origin_device_id_fkey;

ALTER TABLE market_warehouses
  DROP CONSTRAINT IF EXISTS market_warehouses_origin_device_id_fkey;

ALTER TABLE market_sync_state
  ADD COLUMN IF NOT EXISTS server_seq integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS market_pos_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('x_report', 'z_report')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS market_pos_commands_pending_idx
  ON market_pos_commands (customer_id, status, created_at);
