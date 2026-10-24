-- Live, tenant-isolated supermarket snapshots for the owner phone PWA.
CREATE TABLE IF NOT EXISTS market_pos_snapshots (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  app_version text,
  daily_sales_minor integer NOT NULL DEFAULT 0 CHECK (daily_sales_minor >= 0),
  transaction_count integer NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
  open_registers integer NOT NULL DEFAULT 0 CHECK (open_registers >= 0),
  critical_stock integer NOT NULL DEFAULT 0 CHECK (critical_stock >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pos_snapshots_customer_updated_idx
  ON market_pos_snapshots (customer_id, updated_at);
