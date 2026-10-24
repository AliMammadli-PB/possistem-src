-- Per-customer Market POS configuration controlled by POSSISTEM admins.
CREATE TABLE IF NOT EXISTS market_pos_customer_config (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  loyalty_rate_bps integer NOT NULL DEFAULT 0 CHECK (loyalty_rate_bps BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
