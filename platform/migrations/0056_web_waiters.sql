-- Separate identities: a waiter is never a customer/owner/admin session.
CREATE TABLE IF NOT EXISTS waiter_companies (
 customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
 namespace text NOT NULL UNIQUE CHECK(namespace ~ '^[a-z][a-z0-9-]{1,39}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS web_waiters (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES waiter_companies(customer_id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 username text NOT NULL CHECK(username ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),
 full_name text NOT NULL, password_hash text NOT NULL, native_user_id text,
 active boolean NOT NULL DEFAULT true, failed_logins integer NOT NULL DEFAULT 0,
 locked_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,username)
);
CREATE INDEX IF NOT EXISTS web_waiters_owner ON web_waiters(customer_id,device_id);
CREATE TABLE IF NOT EXISTS waiter_sessions (
 id uuid PRIMARY KEY, waiter_id uuid NOT NULL REFERENCES web_waiters(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waiter_sessions_expiry ON waiter_sessions(expires_at);
CREATE TABLE IF NOT EXISTS waiter_requests (
 id uuid PRIMARY KEY, waiter_id uuid NOT NULL REFERENCES web_waiters(id) ON DELETE CASCADE,
 customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 request_hash text NOT NULL, body jsonb NOT NULL,
 state text NOT NULL DEFAULT 'processing' CHECK(state IN ('processing','done','accepted','uncertain','failed')),
 result jsonb, lease_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waiter_requests_staff ON waiter_requests(waiter_id,created_at);
