-- Remote owner branch operations use the same signed command queue as reports.
-- Keep the finite kind allowlist; only add the authenticated core_batch kind.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE market_pos_commands DROP CONSTRAINT IF EXISTS market_pos_commands_kind_check;
ALTER TABLE market_pos_commands ADD CONSTRAINT market_pos_commands_kind_check
  CHECK (kind IN ('x_report', 'z_report', 'core_batch'));
COMMIT;
