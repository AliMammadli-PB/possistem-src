-- 0019 - Separate Restaurant POS and Market POS activation keys.

ALTER TABLE activation_keys
  ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'restaurant';

UPDATE activation_keys ak
SET product = 'market'
FROM licenses l
WHERE l.id = ak.license_id
  AND (
    l.features->>'product' = 'market'
    OR l.features->>'market' = 'true'
    OR lower(coalesce(l.plan, '')) IN ('market', 'mpos', 'retail', 'supermarket')
    OR lower(coalesce(ak.label, '')) ~ '(market|mpos|retail|supermarket|mağaza|magaza)'
  );

-- Guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS, and a bare ADD makes
-- the migration impossible to re-run against a database that already has it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activation_keys_product_check') THEN
    ALTER TABLE activation_keys
      DROP CONSTRAINT IF EXISTS activation_keys_product_check,
      ADD CONSTRAINT activation_keys_product_check CHECK (product IN ('restaurant', 'market'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS activation_keys_product_idx
  ON activation_keys (product);
