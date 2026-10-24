-- GameCenter cafe PC occupancy (1 = occupied/active, 0 = available/empty).
CREATE TABLE IF NOT EXISTS gamecenter_pcs (
  id integer PRIMARY KEY,
  name text NOT NULL,
  ip text NOT NULL DEFAULT '',
  active smallint NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  latency_ms integer,
  source text NOT NULL DEFAULT 'gamecenter-scanner',
  checked_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gamecenter_pcs_checked_at_idx
  ON gamecenter_pcs (checked_at DESC);

CREATE INDEX IF NOT EXISTS gamecenter_pcs_active_idx
  ON gamecenter_pcs (active, id);
