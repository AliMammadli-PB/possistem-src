-- What POSSISTEM grants a customer, separate from what their manager hands staff.
--
-- Two layers were being conflated. `pos_role_policy` answers "which of my staff
-- may refund?" - a question the restaurant's own manager should answer. It never
-- answered "was this customer sold the right to touch Parametrlər at all?",
-- which is ours, and which is the whole point of selling a tier.
--
-- Without the first layer the panel can only ever hand out everything: a
-- customer who was not sold settings access could still grant it to their own
-- manager, because nothing above them said no.
--
-- A customer with no row here is unrestricted - selling a tier is an act, and
-- silence must not lock an existing customer out of what they already had.
CREATE TABLE IF NOT EXISTS pos_entitlements (
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product      text NOT NULL CHECK (product IN ('restaurant', 'market')),
  -- Keys of that product's own catalogue. Meaningless while `unrestricted`.
  allowed      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Explicit rather than "allowed is empty": an empty list is a real answer
  -- (this customer may do nothing) and must not read as "no limits set".
  unrestricted boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  PRIMARY KEY (customer_id, product)
);

-- The role policy is per product too: a customer can hold both tills, and the
-- two cores do not share a permission vocabulary, so one policy cannot serve
-- both. Existing rows are restaurant - it was the only product pulling them.
ALTER TABLE pos_role_policy ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'restaurant';

ALTER TABLE pos_role_policy DROP CONSTRAINT IF EXISTS pos_role_policy_pkey;
ALTER TABLE pos_role_policy ADD PRIMARY KEY (customer_id, product);

ALTER TABLE pos_role_policy
  DROP CONSTRAINT IF EXISTS pos_role_policy_product_check;
ALTER TABLE pos_role_policy
  ADD CONSTRAINT pos_role_policy_product_check CHECK (product IN ('restaurant', 'market'));
