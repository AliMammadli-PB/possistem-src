-- Geyim POS 1.0: clothing attributes. A model is a product row whose variants
-- (one per size and colour, each with its own barcode and stock) point at it
-- through parent_product_id (004). Additive only.
ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN material TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN season TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN gender TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_product_id);
