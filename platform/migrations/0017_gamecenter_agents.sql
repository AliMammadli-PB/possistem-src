-- Per-PC agents: every game PC runs the monitor and shuts itself down, so the
-- main PC only handles Wake-on-LAN and the remote-shutdown fallback.
CREATE TABLE IF NOT EXISTS gamecenter_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_id integer REFERENCES gamecenter_pcs(id),
  hostname text NOT NULL DEFAULT '',
  ip text NOT NULL,
  mac text,
  version text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('main', 'client')),
  os text,
  update_status text,
  host_config text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gamecenter_agents_ip_idx
  ON gamecenter_agents (ip);

CREATE INDEX IF NOT EXISTS gamecenter_agents_pc_idx
  ON gamecenter_agents (pc_id);

CREATE INDEX IF NOT EXISTS gamecenter_agents_last_seen_idx
  ON gamecenter_agents (last_seen_at DESC);

-- Only one agent may act as the scanner/Wake-on-LAN sender at a time.
CREATE UNIQUE INDEX IF NOT EXISTS gamecenter_agents_one_main_idx
  ON gamecenter_agents ((role))
  WHERE role = 'main';

-- 'self'   = the target PC runs shutdown locally (reliable path)
-- 'remote' = the main PC runs shutdown /s /m \\IP (fallback for agent-less PCs)
ALTER TABLE gamecenter_pc_commands
  ADD COLUMN IF NOT EXISTS mode text;

ALTER TABLE gamecenter_pc_commands
  ADD COLUMN IF NOT EXISTS claimed_by uuid;

ALTER TABLE gamecenter_pc_commands
  DROP CONSTRAINT IF EXISTS gamecenter_pc_commands_mode_check;

-- Guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS, and a bare ADD makes
-- the migration impossible to re-run against a database that already has it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gamecenter_pc_commands_mode_check') THEN
    ALTER TABLE gamecenter_pc_commands
      ADD CONSTRAINT gamecenter_pc_commands_mode_check
      CHECK (mode IS NULL OR mode IN ('self', 'remote'));
  END IF;
END $$;

-- Stale wake/shutdown jobs from an outdated agent must not block new commands
-- forever, because only one pending command per PC is allowed.
UPDATE gamecenter_pc_commands
SET status = 'failed',
    result = COALESCE(result, 'Köhnə agent əmri icra etmədi (avtomatik ləğv edildi)'),
    completed_at = now()
WHERE status = 'pending'
  AND created_at < now() - interval '5 minutes';
