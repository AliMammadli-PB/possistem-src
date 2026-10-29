-- Disabling renewal through the existing cancellation workflow must not turn
-- into an unlimited free POS grant. Only explicit new admin grants do that.
UPDATE billing_subscriptions s SET access_mode='subscription',updated_at=now()
WHERE s.access_mode='free' AND NOT s.enabled AND s.cancelled_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM billing_events e WHERE e.entity_id=s.id::text AND e.action IN ('subscription.access.free','subscription.access.delete'));
