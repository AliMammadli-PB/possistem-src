-- Portal chat transcript (WhatsApp-style bot on the phone web app).
CREATE TABLE IF NOT EXISTS owner_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'bot', 'system')),
  body text NOT NULL DEFAULT '',
  client_message_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_chat_messages_customer_idx
  ON owner_chat_messages (customer_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS owner_chat_messages_client_id_uidx
  ON owner_chat_messages (customer_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
