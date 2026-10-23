-- 0036: Aptek POS activation keys. Widens one CHECK to a superset and updates
-- no row. Aptek licences are market-family licences (features.vertical = 'aptek').
BEGIN;
ALTER TABLE activation_keys DROP CONSTRAINT IF EXISTS activation_keys_product_check;
ALTER TABLE activation_keys ADD CONSTRAINT activation_keys_product_check
  CHECK (product IN ('restaurant', 'market', 'geyim', 'aptek'));
COMMIT;
