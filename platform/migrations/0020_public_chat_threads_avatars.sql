-- Thread-based public chat + customer avatars + staff replies

CREATE TABLE IF NOT EXISTS public_chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  title text NOT NULL,
  reply_count integer NOT NULL DEFAULT 0,
  last_reply_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public_chat_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public_chat_threads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

ALTER TABLE public_chat_messages
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS chat_avatar_path text;

CREATE INDEX IF NOT EXISTS public_chat_threads_last_reply_idx
  ON public_chat_threads (last_reply_at DESC);

CREATE INDEX IF NOT EXISTS public_chat_messages_thread_idx
  ON public_chat_messages (thread_id, created_at ASC);

-- Migrate legacy flat messages into one-thread-per-message topics
INSERT INTO public_chat_threads (id, customer_id, author_name, title, reply_count, last_reply_at, created_at)
SELECT
  m.id,
  m.customer_id,
  m.author_name,
  CASE
    WHEN char_length(m.body) <= 100 THEN m.body
    ELSE left(m.body, 97) || '…'
  END,
  0,
  m.created_at,
  m.created_at
FROM public_chat_messages m
WHERE m.thread_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public_chat_messages m
SET thread_id = m.id
WHERE m.thread_id IS NULL;

UPDATE public_chat_threads t
SET reply_count = GREATEST(0, (
  SELECT count(*) - 1
  FROM public_chat_messages m
  WHERE m.thread_id = t.id
)),
last_reply_at = (
  SELECT max(created_at)
  FROM public_chat_messages m
  WHERE m.thread_id = t.id
)
WHERE EXISTS (SELECT 1 FROM public_chat_messages m WHERE m.thread_id = t.id);
