-- Additive: existing licences, prices and history are never rewritten here.
CREATE TABLE billing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  recurring_enabled boolean NOT NULL DEFAULT false,
  pickup_address text NOT NULL DEFAULT '',
  delivery_fee_minor bigint CHECK (delivery_fee_minor BETWEEN 0 AND 100000000),
  legal jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_settings(id) VALUES(true);
CREATE TABLE billing_terms (
  version text PRIMARY KEY,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  product text NOT NULL CHECK (product IN ('market','restaurant','geyim','aptek','topdan')),
  monthly_amount_minor bigint NOT NULL CHECK (monthly_amount_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'AZN' CHECK(currency='AZN'),
  enabled boolean NOT NULL DEFAULT true,
  paid_until timestamptz,
  anchor_day integer CHECK(anchor_day BETWEEN 1 AND 31),
  price_version integer NOT NULL DEFAULT 1,
  auto_renew boolean NOT NULL DEFAULT false,
  consent_version integer,
  card_ciphertext text,
  card_mask text,
  last_attempt_at timestamptz,
  retry_stage integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id,product)
);
CREATE TABLE billing_license_links (
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id),
  license_id uuid NOT NULL UNIQUE REFERENCES licenses(id),
  PRIMARY KEY(subscription_id,license_id)
);
CREATE TABLE billing_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id),
  price_version integer NOT NULL,
  amount_minor bigint NOT NULL,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  ip_hash text NOT NULL
);

-- The imported catalogue remains a source of descriptions only. Stock is
-- imported once, while a new explicit admin price is required for checkout.
CREATE TABLE billing_catalog (
  product_id text PRIMARY KEY,
  name text NOT NULL,
  stock_qty integer NOT NULL CHECK(stock_qty BETWEEN 0 AND 1000000),
  reserved_qty integer NOT NULL DEFAULT 0 CHECK(reserved_qty>=0 AND reserved_qty<=stock_qty),
  price_minor bigint CHECK(price_minor BETWEEN 1 AND 100000000),
  sale_enabled boolean NOT NULL DEFAULT false,
  archived_values jsonb NOT NULL DEFAULT '{}',
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  kind text NOT NULL CHECK(kind IN ('subscription','shop')),
  subscription_id uuid REFERENCES billing_subscriptions(id),
  price_version integer,
  billing_due_at timestamptz,
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'AZN' CHECK(currency='AZN'),
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','processing','unknown','failed','expired','paid','paid_review','refund_pending','refunded')),
  request_key uuid NOT NULL,
  request_hash text NOT NULL,
  delivery_kind text CHECK(delivery_kind IN ('pickup','delivery')),
  delivery_fee_minor bigint NOT NULL DEFAULT 0 CHECK(delivery_fee_minor>=0),
  recipient_name text,
  recipient_phone text,
  delivery_address text,
  fulfillment_status text NOT NULL DEFAULT 'waiting' CHECK(fulfillment_status IN ('waiting','preparing','ready','dispatched','completed','cancelled')),
  note text NOT NULL DEFAULT '',
  save_card_consent boolean NOT NULL DEFAULT false,
  consent_id uuid REFERENCES billing_consents(id),
  terms_version text,
  expires_at timestamptz,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id,request_key)
);
-- At most one unsettled invoice for a subscription, including uncertain debits.
CREATE UNIQUE INDEX billing_subscription_open ON billing_orders(subscription_id)
  WHERE kind='subscription' AND status IN ('awaiting_payment','processing','unknown','refund_pending','paid_review');
CREATE TABLE billing_order_items (
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  product_id text NOT NULL REFERENCES billing_catalog(product_id),
  name text NOT NULL,
  qty integer NOT NULL CHECK(qty BETWEEN 1 AND 1000000),
  unit_price_minor bigint NOT NULL CHECK(unit_price_minor>0),
  reservation_state text NOT NULL DEFAULT 'reserved' CHECK(reservation_state IN ('reserved','released','consumed')),
  PRIMARY KEY(order_id,product_id)
);
CREATE TABLE billing_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  provider_order_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK(kind IN ('checkout','recurring','refund')),
  status text NOT NULL CHECK(status IN ('sending','redirect','pending','succeeded','failed','unknown','refunded')),
  transaction_id text,
  redirect_url text,
  response jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_payment_transaction ON billing_attempts(transaction_id)
  WHERE transaction_id IS NOT NULL AND kind<>'refund';
CREATE UNIQUE INDEX billing_one_active_attempt ON billing_attempts(order_id)
  WHERE status IN ('sending','redirect','pending','unknown') AND kind<>'refund';
CREATE TABLE billing_events (
  id bigserial PRIMARY KEY,
  event_key text UNIQUE,
  entity_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_period_grants (
  order_id uuid PRIMARY KEY REFERENCES billing_orders(id),
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  reversed_at timestamptz
);
CREATE TABLE billing_handoffs (
  token_hash text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  product text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE billing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  payload jsonb NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes')
);
CREATE INDEX billing_orders_customer_date ON billing_orders(customer_id,created_at DESC);
CREATE INDEX billing_due_subscriptions ON billing_subscriptions(paid_until) WHERE enabled AND auto_renew;
CREATE INDEX billing_attempt_reconcile ON billing_attempts(updated_at) WHERE status IN ('sending','pending','redirect','unknown');
