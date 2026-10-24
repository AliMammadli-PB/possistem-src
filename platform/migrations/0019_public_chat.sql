-- Public community chat (marketing site /destek/chat/)
CREATE TABLE IF NOT EXISTS public_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_chat_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public_chat_messages(id) ON DELETE CASCADE,
  mentioned_customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  mentioned_by_customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_chat_messages_created_at_idx
  ON public_chat_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS public_chat_mentions_customer_idx
  ON public_chat_mentions (mentioned_customer_id, read_at);

INSERT INTO feature_flags (key, description, enabled, scope, payload)
VALUES (
  'public.chat.cooldown_minutes',
  'Minutes between public chat messages per customer',
  true,
  'global',
  '{"minutes": 10}'::jsonb
)
-- Must name the partial index's predicate: 0012 replaced the plain unique on
-- (key) with `UNIQUE (key) WHERE scope = 'global'`, and a bare ON CONFLICT (key)
-- can no longer infer an arbiter index — it aborts this migration and every one
-- after it.
ON CONFLICT (key) WHERE scope = 'global' DO NOTHING;
