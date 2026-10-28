CREATE TABLE IF NOT EXISTS restaurant_qr_menus (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 device_id uuid NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE, public_token text NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
 document jsonb NOT NULL DEFAULT '{}'::jsonb, table_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_qr_customer_idx ON restaurant_qr_menus(customer_id);
CREATE TABLE IF NOT EXISTS restaurant_qr_orders (
 id uuid PRIMARY KEY, menu_id uuid NOT NULL REFERENCES restaurant_qr_menus(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, request_hash text NOT NULL, receipt_token text NOT NULL,
 table_id text NOT NULL, table_label text NOT NULL, menu_revision integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepting','accepted','rejected','expired')),
 lines jsonb NOT NULL, note text NOT NULL DEFAULT '', subtotal_minor bigint NOT NULL CHECK(subtotal_minor>=0),
 claim_token text, claim_until timestamptz, pos_order_id text, reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(menu_id,request_id)
);
CREATE INDEX IF NOT EXISTS restaurant_qr_pending_idx ON restaurant_qr_orders(menu_id,status,created_at);
CREATE TABLE IF NOT EXISTS restaurant_qr_events (
 id bigserial PRIMARY KEY, menu_id uuid NOT NULL REFERENCES restaurant_qr_menus(id) ON DELETE CASCADE,
 order_id uuid REFERENCES restaurant_qr_orders(id) ON DELETE CASCADE, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
