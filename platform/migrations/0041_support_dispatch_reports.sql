CREATE TABLE IF NOT EXISTS support_service_settings (
 id integer PRIMARY KEY CHECK(id=1),
 enabled boolean NOT NULL DEFAULT true,
 start_minute integer NOT NULL DEFAULT 600 CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute integer NOT NULL DEFAULT 1080 CHECK(end_minute BETWEEN 1 AND 1440),
 week_days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
 offer_seconds integer NOT NULL DEFAULT 30 CHECK(offer_seconds BETWEEN 10 AND 180),
 max_active integer NOT NULL DEFAULT 1 CHECK(max_active BETWEEN 1 AND 20),
 activated_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_minute>start_minute)
);
INSERT INTO support_service_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS support_staff_devices (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('android','web')),
 app_version text NOT NULL DEFAULT '',
 enabled boolean NOT NULL DEFAULT true,
 available boolean NOT NULL DEFAULT true,
 priority integer NOT NULL DEFAULT 100,
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 last_offer_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_staff_online_idx ON support_staff_devices(enabled,last_seen_at,priority);
CREATE TABLE IF NOT EXISTS support_dispatch_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_type text NOT NULL CHECK(source_type IN ('ticket','public_chat')),
 source_id uuid NOT NULL,
 title text NOT NULL,
 preview text NOT NULL,
 event_at timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1,
 acknowledged_version integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','offered','accepted','resolved')),
 device_id uuid REFERENCES support_staff_devices(id) ON DELETE SET NULL,
 offer_id uuid,
 expires_at timestamptz,
 attempted_devices uuid[] NOT NULL DEFAULT '{}',
 retry_after timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_type,source_id)
);
CREATE INDEX IF NOT EXISTS support_dispatch_waiting_idx ON support_dispatch_jobs(status,retry_after);
CREATE TABLE IF NOT EXISTS support_dispatch_attempts (
 id bigserial PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES support_dispatch_jobs(id) ON DELETE CASCADE,
 device_id uuid REFERENCES support_staff_devices(id) ON DELETE SET NULL,
 offer_id uuid NOT NULL,
 offered_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 decision text NOT NULL DEFAULT 'offered',
 decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_dispatch_attempt_job_idx ON support_dispatch_attempts(job_id,offered_at DESC);
CREATE TABLE IF NOT EXISTS support_assistant_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
 language text NOT NULL CHECK(language IN ('az','en','ru')),
 reason text NOT NULL,
 comment text NOT NULL DEFAULT '',
 transcript jsonb NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','resolved')),
 admin_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_assistant_report_status_idx ON support_assistant_reports(status,created_at DESC);
-- An outbox lets messages submitted outside business hours send their existing email during work hours.
CREATE TABLE IF NOT EXISTS support_email_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 delivered_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_email_one_pending_idx ON support_email_queue(ticket_id) WHERE delivered_at IS NULL;
