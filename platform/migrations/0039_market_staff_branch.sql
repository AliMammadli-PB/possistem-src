-- Market POS 1.5.34: which filial (branches.id) a worker belongs to; '' = every filial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE market_staff ADD COLUMN IF NOT EXISTS branch_id text NOT NULL DEFAULT '';
INSERT INTO _migrations (id) VALUES ('0039_market_staff_branch.sql') ON CONFLICT DO NOTHING;
COMMIT;
