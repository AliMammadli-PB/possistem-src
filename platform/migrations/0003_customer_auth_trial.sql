-- Tenant (restaurant customer) login credentials + payment URL setting.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Unique email for customers that have one (tenant login).
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_uidx
  ON customers (lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- Global payment CTA URL for expired / trial-ended licenses (feature_flags.payload).
INSERT INTO feature_flags (key, description, enabled, scope, payload)
VALUES (
  'payment.url',
  'Public payment / contact URL shown in POS when license expires',
  true,
  'global',
  '{"url":"https://offlinegame.az/#elaqe"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
