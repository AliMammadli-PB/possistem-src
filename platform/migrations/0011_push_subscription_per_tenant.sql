-- One push subscription per browser *per restaurant*.
--
-- `endpoint` was globally unique, so `/owner/push/subscribe` moved the existing
-- row to whichever restaurant subscribed last. A browser that had been signed
-- in to two venues left the first one silently unsubscribed — no error, no
-- notification, nothing on either screen to say the channel had gone.

DO $$
DECLARE
  con TEXT;
BEGIN
  -- The constraint was created inline by 0004, so its generated name is the one
  -- Postgres chose; look it up rather than guess.
  SELECT conname INTO con
    FROM pg_constraint
   WHERE conrelid = 'owner_push_subscriptions'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (endpoint)';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE owner_push_subscriptions DROP CONSTRAINT %I', con);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS owner_push_customer_endpoint_uidx
  ON owner_push_subscriptions (customer_id, endpoint);
