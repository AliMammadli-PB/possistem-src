-- Admin grants are access rights, never fabricated bank payments. Financial
-- records survive removal of a subscription from the active management list.
ALTER TABLE billing_subscriptions ADD COLUMN access_mode text NOT NULL DEFAULT 'subscription' CHECK (access_mode IN ('subscription','trial','free'));
ALTER TABLE billing_subscriptions ADD COLUMN trial_until timestamptz;
ALTER TABLE billing_subscriptions ADD COLUMN deleted_at timestamptz;
UPDATE billing_subscriptions SET access_mode='free' WHERE NOT enabled;
CREATE INDEX billing_subscriptions_access ON billing_subscriptions(customer_id,product,access_mode);
