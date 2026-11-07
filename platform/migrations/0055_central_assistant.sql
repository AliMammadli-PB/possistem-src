-- Additive: existing support reports and business data are unchanged.
CREATE TABLE IF NOT EXISTS assistant_knowledge_revisions (
 id bigserial PRIMARY KEY, entries jsonb NOT NULL DEFAULT '[]',
 created_by uuid REFERENCES users(id) ON DELETE SET NULL, restored_from bigint,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assistant_knowledge_state (
 id integer PRIMARY KEY CHECK(id=1), draft jsonb NOT NULL DEFAULT '[]',
 draft_version integer NOT NULL DEFAULT 1,
 published_revision bigint REFERENCES assistant_knowledge_revisions(id),
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO assistant_knowledge_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS assistant_sessions (
 id uuid PRIMARY KEY, customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
 secret_hash text NOT NULL, surface text NOT NULL CHECK(surface IN ('site','restaurant')),
 device_id uuid REFERENCES devices(id) ON DELETE CASCADE, actor_id text NOT NULL DEFAULT '',
 capabilities jsonb NOT NULL DEFAULT '{}', revision bigint NOT NULL DEFAULT 0,
 state jsonb NOT NULL DEFAULT '{}', turn jsonb, last_result jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE INDEX IF NOT EXISTS assistant_sessions_customer ON assistant_sessions(customer_id,updated_at);
CREATE INDEX IF NOT EXISTS assistant_sessions_expiry ON assistant_sessions(expires_at);
