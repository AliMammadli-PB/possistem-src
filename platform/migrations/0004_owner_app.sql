-- Owner mobile app: HWID bind, notify email, floor snapshot, notifications, push

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS bound_hwid TEXT,
  ADD COLUMN IF NOT EXISTS notify_email TEXT;

UPDATE customers
SET notify_email = email
WHERE notify_email IS NULL AND email IS NOT NULL;

CREATE TABLE IF NOT EXISTS owner_floor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  open_tables INTEGER NOT NULL DEFAULT 0,
  open_total_minor INTEGER NOT NULL DEFAULT 0,
  today_sales_minor INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);

CREATE INDEX IF NOT EXISTS owner_floor_customer_idx ON owner_floor_snapshots(customer_id);

CREATE TABLE IF NOT EXISTS owner_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_notifications_customer_idx
  ON owner_notifications(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS owner_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS owner_push_customer_idx ON owner_push_subscriptions(customer_id);
