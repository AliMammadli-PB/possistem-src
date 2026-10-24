CREATE TABLE IF NOT EXISTS market_products (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  payload jsonb NOT NULL,
  logical_at bigint NOT NULL,
  origin_device_id uuid NOT NULL REFERENCES devices(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id, product_id)
);

CREATE TABLE IF NOT EXISTS market_stock_balances (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  warehouse_id text NOT NULL,
  qty bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id, product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS market_warehouses (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  warehouse_id text NOT NULL,
  payload jsonb NOT NULL,
  logical_at bigint NOT NULL,
  origin_device_id uuid NOT NULL REFERENCES devices(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS market_sync_events (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  origin_device_id uuid NOT NULL REFERENCES devices(id),
  origin_seq integer NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id, event_id),
  UNIQUE(customer_id, origin_device_id, origin_seq)
);

CREATE TABLE IF NOT EXISTS market_device_vectors (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  vector jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id, device_id)
);

CREATE TABLE IF NOT EXISTS market_sync_state (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  bootstrap_device_id uuid REFERENCES devices(id),
  bootstrap_completed_at timestamptz,
  catalog_revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_sync_events_customer_received_idx
  ON market_sync_events(customer_id, received_at);
CREATE INDEX IF NOT EXISTS market_stock_balances_customer_updated_idx
  ON market_stock_balances(customer_id, updated_at);
