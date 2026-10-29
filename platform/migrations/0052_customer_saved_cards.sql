-- Cards a customer saved while buying in the shop. The bank's card token is stored only
-- encrypted (same key as subscription cards); a removed card loses its token.
CREATE TABLE IF NOT EXISTS billing_cards(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  card_ciphertext text,
  card_mask text NOT NULL,
  source_order_id uuid REFERENCES billing_orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_cards_active_mask ON billing_cards(customer_id,card_mask) WHERE removed_at IS NULL;
