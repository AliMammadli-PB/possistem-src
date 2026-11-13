-- Table dining money is isolated from Possistem subscription/shop billing.
CREATE TABLE IF NOT EXISTS restaurant_payment_merchants (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id),device_id uuid REFERENCES devices(id),
 public_key text NOT NULL,private_cipher text NOT NULL,active boolean NOT NULL DEFAULT true,
 verified boolean NOT NULL DEFAULT false,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_merchant_current ON restaurant_payment_merchants(customer_id,COALESCE(device_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE active;
CREATE TABLE IF NOT EXISTS restaurant_payment_bills (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id),device_id uuid NOT NULL REFERENCES devices(id),
 merchant_id uuid NOT NULL REFERENCES restaurant_payment_merchants(id),pos_session_id text NOT NULL,
 secret_cipher text NOT NULL,public_nonce text NOT NULL,snapshot jsonb NOT NULL,state text NOT NULL DEFAULT 'open' CHECK(state IN('open','closed','cancelled')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(device_id,pos_session_id)
);
CREATE TABLE IF NOT EXISTS restaurant_table_payments (
 id uuid PRIMARY KEY,bill_id uuid NOT NULL REFERENCES restaurant_payment_bills(id),request_id uuid NOT NULL,
 fingerprint text NOT NULL,selection jsonb NOT NULL,allocations jsonb NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),
 status text NOT NULL CHECK(status IN('reserving','creating','pending','unknown','paid','applied','failed','review')),
 provider_order_id text NOT NULL UNIQUE,provider_transaction text UNIQUE,redirect_url text,provider_result jsonb NOT NULL DEFAULT '{}',
 native_payment_id text,native_released_at timestamptz,error text,applied_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bill_id,request_id)
);
CREATE INDEX IF NOT EXISTS restaurant_payment_reconcile ON restaurant_table_payments(updated_at) WHERE status IN('reserving','pending','paid','failed');

CREATE TABLE IF NOT EXISTS restaurant_payment_events (
 id uuid PRIMARY KEY,payment_id uuid NOT NULL REFERENCES restaurant_table_payments(id),
 event text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
