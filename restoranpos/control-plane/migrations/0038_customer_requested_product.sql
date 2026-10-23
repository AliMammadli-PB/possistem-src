-- 0038: the program a customer chose when registering on the web portal.
-- One nullable column; updates no row.
BEGIN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS requested_product text;
COMMIT;
