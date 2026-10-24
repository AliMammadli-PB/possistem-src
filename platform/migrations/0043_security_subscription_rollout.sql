-- Explicit staged rollout: prices are recorded, unpaid use is not blocked until
-- the owner enables enforcement after bank verification. Never fake a payment.
ALTER TABLE billing_settings ADD COLUMN enforcement_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN auth_epoch timestamptz NOT NULL DEFAULT 'epoch';
CREATE TABLE tenant_session_revocations(token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE INDEX tenant_session_revocations_expiry ON tenant_session_revocations(expires_at);
CREATE FUNCTION invalidate_customer_sessions_on_password_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
  NEW.auth_epoch = clock_timestamp();
  DELETE FROM customer_sessions WHERE customer_id = NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_password_session_epoch BEFORE UPDATE OF password_hash ON customers
 FOR EACH ROW EXECUTE FUNCTION invalidate_customer_sessions_on_password_change();
WITH eligible AS (
 SELECT l.customer_id,CASE WHEN COALESCE(l.features->>'vertical',l.features->>'product',l.plan)='market' THEN 'market' ELSE 'restaurant' END product,
 CASE WHEN bool_or(l.valid_until IS NULL) THEN NULL ELSE max(l.valid_until) END paid_until
 FROM licenses l JOIN customers c ON c.id=l.customer_id
 WHERE c.active AND l.status NOT IN ('revoked','suspended') AND
 COALESCE(l.features->>'vertical',l.features->>'product',l.plan) IN ('market','restaurant')
 GROUP BY l.customer_id,CASE WHEN COALESCE(l.features->>'vertical',l.features->>'product',l.plan)='market' THEN 'market' ELSE 'restaurant' END
)
INSERT INTO billing_subscriptions(customer_id,product,monthly_amount_minor,enabled,paid_until)
SELECT customer_id,product,5000,true,paid_until FROM eligible
ON CONFLICT(customer_id,product) DO UPDATE SET monthly_amount_minor=5000,enabled=true,
 price_version=billing_subscriptions.price_version+CASE WHEN billing_subscriptions.monthly_amount_minor<>5000 THEN 1 ELSE 0 END,
 auto_renew=CASE WHEN billing_subscriptions.monthly_amount_minor<>5000 THEN false ELSE billing_subscriptions.auto_renew END,updated_at=now();
INSERT INTO billing_license_links(subscription_id,license_id)
SELECT s.id,l.id FROM billing_subscriptions s JOIN licenses l ON l.customer_id=s.customer_id
 JOIN customers c ON c.id=l.customer_id
WHERE c.active AND l.status NOT IN ('revoked','suspended')
 AND COALESCE(l.features->>'vertical',l.features->>'product',l.plan)=s.product
ON CONFLICT DO NOTHING;
UPDATE licenses l SET features=COALESCE(l.features,'{}'::jsonb)||'{"billingManaged":true,"offlineGraceDays":0}'::jsonb
FROM billing_license_links b WHERE b.license_id=l.id;
UPDATE billing_consents c SET withdrawn_at=now() FROM billing_subscriptions s
 WHERE c.subscription_id=s.id AND c.price_version<>s.price_version AND c.withdrawn_at IS NULL;


-- A short signed access lease, not a paid period. Revocations remain authoritative.
UPDATE licenses l SET status='active',valid_until=GREATEST(COALESCE(valid_until,now()),now()+interval '7 days')
FROM billing_license_links b JOIN billing_subscriptions s ON s.id=b.subscription_id JOIN customers c ON c.id=s.customer_id
WHERE b.license_id=l.id AND c.active AND l.status NOT IN ('revoked','suspended');
UPDATE activation_keys k SET expires_at=GREATEST(COALESCE(expires_at,now()),now()+interval '7 days')
FROM billing_license_links b JOIN licenses l ON l.id=b.license_id
WHERE k.license_id=l.id AND k.revoked_at IS NULL AND l.status='active';
INSERT INTO billing_events(entity_id,actor_id,action,detail) VALUES('all','system','subscription.rollout','{"monthlyAmountMinor":5000,"enforcementEnabled":false}'::jsonb);
