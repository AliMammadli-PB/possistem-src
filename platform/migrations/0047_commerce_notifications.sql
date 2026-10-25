-- Durable, customer-scoped notifications, deduplicated across worker restarts.
CREATE UNIQUE INDEX IF NOT EXISTS owner_notifications_billing_key_idx
 ON owner_notifications(customer_id,(payload->>'billingKey'))
 WHERE payload ? 'billingKey';
