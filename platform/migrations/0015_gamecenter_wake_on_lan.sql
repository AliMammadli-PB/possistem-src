-- Remember MAC addresses learned by the local scanner and queue Wake-on-LAN jobs.
ALTER TABLE gamecenter_pcs
  ADD COLUMN IF NOT EXISTS mac text;

CREATE TABLE IF NOT EXISTS gamecenter_pc_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_id integer NOT NULL REFERENCES gamecenter_pcs(id),
  command text NOT NULL DEFAULT 'wake' CHECK (command IN ('wake')),
  mac text NOT NULL,
  ip text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  requested_by text NOT NULL DEFAULT 'gamecenter-admin',
  attempts integer NOT NULL DEFAULT 0,
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS gamecenter_pc_commands_status_idx
  ON gamecenter_pc_commands (status, created_at);

CREATE INDEX IF NOT EXISTS gamecenter_pc_commands_pc_idx
  ON gamecenter_pc_commands (pc_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS gamecenter_pc_commands_one_pending_idx
  ON gamecenter_pc_commands (pc_id)
  WHERE status = 'pending';
