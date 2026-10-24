-- 0035: Geyim POS activation keys. Widens one CHECK to a superset and updates
-- no row: every existing product ('restaurant', 'market') still passes.
-- Geyim licences are market licences (features.vertical = 'geyim'), so the
-- product CHECKs of pos_role_policy and pos_entitlements stay as they are.
BEGIN;
ALTER TABLE activation_keys DROP CONSTRAINT IF EXISTS activation_keys_product_check;
ALTER TABLE activation_keys ADD CONSTRAINT activation_keys_product_check
  CHECK (product IN ('restaurant', 'market', 'geyim'));
COMMIT;
