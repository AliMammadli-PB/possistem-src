-- Partial refunds (the refund attempt carries its own amount; the order keeps what was returned)
-- and one-off charges an admin takes from a customer's saved card.
ALTER TABLE billing_attempts ADD COLUMN IF NOT EXISTS amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor>0);
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS refunded_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS admin_charge boolean NOT NULL DEFAULT false;
UPDATE billing_orders SET refunded_minor=amount_minor WHERE status='refunded' AND paid_at IS NOT NULL AND refunded_minor=0;
UPDATE billing_orders SET admin_charge=true WHERE order_no LIKE 'TEST-%' AND kind='shop';
