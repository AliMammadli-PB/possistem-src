-- Allow remote shutdown commands alongside Wake-on-LAN.
ALTER TABLE gamecenter_pc_commands
  DROP CONSTRAINT IF EXISTS gamecenter_pc_commands_command_check;

-- Guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS, and a bare ADD makes
-- the migration impossible to re-run against a database that already has it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gamecenter_pc_commands_command_check') THEN
    ALTER TABLE gamecenter_pc_commands
      ADD CONSTRAINT gamecenter_pc_commands_command_check
      CHECK (command IN ('wake', 'shutdown'));
  END IF;
END $$;
