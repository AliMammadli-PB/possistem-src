-- Customer portal: secure browser sessions, password recovery, onboarding, and
-- support diagnostics. POS/desktop bearer authentication remains unchanged.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_source TEXT NOT NULL DEFAULT 'staff';

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS audit_logs_actor_customer_idx
  ON audit_logs(actor_customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  remember_me BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx
  ON customer_sessions(customer_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx
  ON customer_sessions(expires_at);

CREATE TABLE IF NOT EXISTS customer_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_password_resets_customer_idx
  ON customer_password_resets(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_password_resets_expiry_idx
  ON customer_password_resets(expires_at);

CREATE TABLE IF NOT EXISTS customer_onboarding (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 7),
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  installation_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (installation_status IN (
      'not_started',
      'downloaded',
      'installing',
      'awaiting_connection',
      'verified',
      'error'
    )),
  downloaded_version TEXT,
  installed_version TEXT,
  last_download_at TIMESTAMPTZ,
  last_check_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_support_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 10485760),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'reviewed', 'deleted')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_support_uploads_customer_idx
  ON customer_support_uploads(customer_id, created_at DESC);

-- Existing sold customers enter with an onboarding record but are not falsely
-- marked verified. Their real device heartbeat will complete verification.
INSERT INTO customer_onboarding (customer_id, current_step, completed_steps)
SELECT id, 1, '[]'::jsonb
FROM customers
ON CONFLICT (customer_id) DO NOTHING;
