-- Staff-created topics + chat-only customer bans
ALTER TABLE public_chat_threads
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS chat_banned_at timestamptz;

CREATE INDEX IF NOT EXISTS customers_chat_banned_idx
  ON customers (chat_banned_at)
  WHERE chat_banned_at IS NOT NULL;
