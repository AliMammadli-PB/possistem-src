-- Non-financial, account-scoped simulator. Never shares real order/payment tables.
CREATE TABLE billing_test_products (
 id text PRIMARY KEY, allowed_email text NOT NULL CHECK(allowed_email=lower(allowed_email)),
 name text NOT NULL, price_minor integer NOT NULL CHECK(price_minor BETWEEN 1 AND 1000000),
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_test_products(id,allowed_email,name,price_minor)
 VALUES('possistem-private-checkout-test','ali.mammadli@possistem.az','Sınaq məhsulu — real ödəniş deyil',100);
CREATE TABLE billing_test_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES billing_test_products(id),
 actor_kind text NOT NULL CHECK(actor_kind IN ('admin','customer')), actor_id uuid NOT NULL,
 qty integer NOT NULL CHECK(qty BETWEEN 1 AND 10), amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 10000000),
 status text NOT NULL CHECK(status IN ('simulated_success','simulated_failure')),
 request_key uuid NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_kind,actor_id,request_key)
);
CREATE INDEX billing_test_orders_actor ON billing_test_orders(actor_kind,actor_id,created_at DESC);
