-- 0037: Topdan POS (wholesale) activation keys, and the product a site visitor
-- asks about. Widens one CHECK to a superset and adds one nullable column;
-- updates no row. Topdan licences are market-family (features.vertical = 'topdan').
BEGIN;
ALTER TABLE activation_keys DROP CONSTRAINT IF EXISTS activation_keys_product_check;
ALTER TABLE activation_keys ADD CONSTRAINT activation_keys_product_check
  CHECK (product IN ('restaurant', 'market', 'geyim', 'aptek', 'topdan'));
ALTER TABLE contact_leads ADD COLUMN IF NOT EXISTS product text;
COMMIT;
