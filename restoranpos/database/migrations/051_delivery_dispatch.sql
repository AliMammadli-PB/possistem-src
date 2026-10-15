-- Delivery from the floor (1.8.1).
--
-- A delivery bill sits on a table of its own in the "Çatdırılma" area (made
-- on first use; a table whose bill is closed leaves the floor plan until the
-- next delivery reuses it), so the order screen, kitchen tickets and payment
-- work exactly as for a table.
--
--   delivery_orders.pay_mode   - 'paid': the guest paid at the till;
--                                'courier': the guest pays the courier, the
--                                bill goes on the courier's account.
--   delivery_orders.settled_at - when the courier handed that money in.
--   couriers.customer_id       - the courier's account (a partner).

ALTER TABLE delivery_orders ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_orders ADD COLUMN pay_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_orders ADD COLUMN settled_at INTEGER;
ALTER TABLE delivery_orders ADD COLUMN settled_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE couriers ADD COLUMN customer_id TEXT REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_delivery_settle ON delivery_orders(pay_mode, settled_at);
