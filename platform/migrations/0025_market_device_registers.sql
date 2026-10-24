ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS register_name text;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS register_name_updated_at timestamptz;
