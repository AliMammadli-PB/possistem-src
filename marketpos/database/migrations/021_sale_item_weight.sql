-- Preserve the scanned weight independently of rounded money. Old receipts
-- retain NULL and keep the legacy inference; existing financial values stay intact.
ALTER TABLE sale_items ADD COLUMN qty_milli INTEGER CHECK (qty_milli IS NULL OR qty_milli > 0);
