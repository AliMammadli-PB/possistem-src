-- Topdan POS 1.0: medicine attributes. Additive only.
--   inn            active ingredient (international non-proprietary name)
--   strength       "500 mg", "5 mg/ml"
--   dosage_form    tablet, capsule, syrup, ... (see src/pharmacy.ts)
--   pack_units     units in one pack (20 tablets); stock of a split product is in units
--   split_allowed  1 = a pack may be opened and sold by the unit
--   rx_required    1 = prescription only
--   storage        room / cool (2-8 °C) / frozen
ALTER TABLE products ADD COLUMN inn TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN strength TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN dosage_form TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN pack_units INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN split_allowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN rx_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN storage TEXT NOT NULL DEFAULT 'room';
ALTER TABLE products ADD COLUMN manufacturer TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN reg_no TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_inn ON products(inn);
CREATE INDEX IF NOT EXISTS idx_lots_product_expiry ON product_lots(product_id, expires_at);
