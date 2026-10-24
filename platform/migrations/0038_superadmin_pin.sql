-- Market POS 1.5.33: the POSSISTEM super admin 10-digit PIN. Hashes only (scrypt),
-- one row; tills get them signed in /market-pos/roles and check the PIN offline.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS superadmin_pin (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  salt text NOT NULL,
  hash text NOT NULL,
  prefix_salt text NOT NULL,
  prefix_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
ALTER TABLE superadmin_pin OWNER TO possistem_pos;
INSERT INTO _migrations (id) VALUES ('0038_superadmin_pin.sql') ON CONFLICT DO NOTHING;
COMMIT;
