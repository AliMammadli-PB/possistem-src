-- Unassigned drafts can be scanned before any menu/product exists.
ALTER TABLE restaurant_qr_scans ALTER COLUMN menu_id DROP NOT NULL;
ALTER TABLE restaurant_qr_scans ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE restaurant_qr_scans ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE restaurant_qr_models ALTER COLUMN menu_id DROP NOT NULL;
ALTER TABLE restaurant_qr_models ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE restaurant_qr_models ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='restaurant_qr_models_publish_binding') THEN
  ALTER TABLE restaurant_qr_models ADD CONSTRAINT restaurant_qr_models_publish_binding CHECK(NOT published OR(menu_id IS NOT NULL AND product_id IS NOT NULL));
 END IF;
END $$;
