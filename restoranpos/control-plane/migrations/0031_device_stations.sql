-- One shop, several computers.
--
-- A restaurant runs the till, the kitchen screen and the store room on
-- different PCs; they share one database on the PC marked as host, and the
-- others reach it over the LAN. The owner sets each PC's job and which one is
-- the host from the customer portal; the tills read it on their 5 s sync.
--
-- Additive only: every existing device keeps doing everything ('all') and no
-- device is a host, which is exactly today's behaviour.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS station text NOT NULL DEFAULT 'all';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS lan_host boolean NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS lan_address text;

DO $$ BEGIN
  ALTER TABLE devices ADD CONSTRAINT devices_station_check
    CHECK (station IN ('all', 'cashier', 'waiter', 'kitchen', 'warehouse'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The tenant login used to tie one e-mail to one PC through customers.bound_hwid.
-- That stays the first PC; further PCs are listed here, up to the seats bought.
CREATE TABLE IF NOT EXISTS customer_hwids (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  hwid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, hwid)
);
