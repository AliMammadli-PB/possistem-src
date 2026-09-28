-- Topdan POS (wholesale): three price levels per product, the pack a product
-- ships in (qutu, yeşik, blok…), and wholesale customers with a price level,
-- tax id (VÖEN) and address for the invoice. Additive only.
ALTER TABLE products ADD COLUMN price_wholesale_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN price_dealer_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN pack_name TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN price_tier TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE customers ADD COLUMN voen TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN note TEXT NOT NULL DEFAULT '';
