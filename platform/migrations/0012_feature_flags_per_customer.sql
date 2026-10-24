-- Makes the `scope`/`scope_id` columns on feature_flags actually usable.
--
-- The table was designed for per-customer overrides — it has `scope`,
-- `scope_id`, and a composite unique index on `(key, scope, scope_id)` — but two
-- unique constraints on `key` alone (`feature_flags_key_key` from the original
-- CREATE TABLE, and `feature_flags_key_uidx` added in 0002 so Drizzle's
-- `onConflictDoUpdate({ target: featureFlags.key })` had something to aim at)
-- meant a key could only ever exist once in the whole table. The composite index
-- has therefore never been reachable, and no customer could be given its own
-- update channel or version pin.
--
-- Both are replaced with partial uniques that keep the same guarantee where it
-- was wanted — one global row per key — while allowing one row per key per
-- scoped owner.

ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_key_key;
DROP INDEX IF EXISTS feature_flags_key_uidx;

-- Still exactly one global row per key, so the existing global upserts keep
-- working; they now say `targetWhere: scope = 'global'` to match this index.
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_global_key_uidx
    ON feature_flags (key)
    WHERE scope = 'global';

-- One row per key per scoped owner (a customer, a reseller).
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_scoped_key_uidx
    ON feature_flags (key, scope, scope_id)
    WHERE scope_id IS NOT NULL;

-- Finding "every override for this customer" was a full scan.
CREATE INDEX IF NOT EXISTS feature_flags_scope_idx
    ON feature_flags (scope, scope_id);
