-- Market POS 1.5.32: the account's users shared between its PCs (salted PIN
-- hashes, never a PIN), and the admin's per-worker allow / deny.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS market_staff (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  salt text NOT NULL DEFAULT '',
  pin_hash text NOT NULL DEFAULT '',
  register_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  warehouse_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  object_id text NOT NULL DEFAULT '',
  places_set boolean NOT NULL DEFAULT false,
  salary_minor bigint NOT NULL DEFAULT 0,
  employee_id text,
  deleted boolean NOT NULL DEFAULT false,
  updated_at bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, staff_id)
);
ALTER TABLE pos_role_policy ADD COLUMN IF NOT EXISTS users jsonb NOT NULL DEFAULT '[]'::jsonb;
INSERT INTO _migrations (id) VALUES ('0037_market_staff.sql') ON CONFLICT DO NOTHING;
COMMIT;
