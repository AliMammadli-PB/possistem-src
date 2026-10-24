-- Live support tickets + messages (POS destek, admin chat, 10-min presence).
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'presence')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'resolved')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  subject text,
  claimed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_customer_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_customer_presence_idx
  ON support_tickets (customer_id)
  WHERE kind = 'presence';

CREATE INDEX IF NOT EXISTS support_tickets_chat_status_idx
  ON support_tickets (status, last_message_at DESC)
  WHERE kind = 'chat';

CREATE INDEX IF NOT EXISTS support_tickets_customer_idx
  ON support_tickets (customer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('customer', 'admin', 'system')),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_created_idx
  ON support_messages (ticket_id, created_at);
