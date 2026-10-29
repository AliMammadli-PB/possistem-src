-- Subscription cancellation: the customer only asks (with a reason); the admin cancels or
-- declines, chooses when it takes effect and which payments to refund. When money is not
-- returned the admin writes why, and the customer sees that note.
CREATE TABLE IF NOT EXISTS billing_cancel_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'customer' CHECK (source IN ('customer','admin')),
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','rejected')),
  cancel_mode text CHECK (cancel_mode IN ('period_end','immediate')),
  effective_at timestamptz,
  refund_order_ids uuid[] NOT NULL DEFAULT '{}',
  decision_note text NOT NULL DEFAULT '',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_cancel_requests_one_pending ON billing_cancel_requests(subscription_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS billing_cancel_requests_customer ON billing_cancel_requests(customer_id,created_at DESC);
ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS cancel_effective_at timestamptz;
