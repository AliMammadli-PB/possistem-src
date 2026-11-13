CREATE TABLE IF NOT EXISTS restaurant_qr_scans(
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 menu_id uuid NOT NULL REFERENCES restaurant_qr_menus(id) ON DELETE CASCADE,
 product_id text NOT NULL, option_ids jsonb NOT NULL DEFAULT '[]', width_cm numeric NOT NULL CHECK(width_cm BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'collecting' CHECK(status IN('collecting','queued','processing','ready','failed','cancelled','expired')),
 stage text NOT NULL DEFAULT 'photos', attempts integer NOT NULL DEFAULT 0,
 claim_token text, lease_until timestamptz, worker_id text, error text,
 model_id uuid REFERENCES restaurant_qr_models(id) ON DELETE SET NULL,
 consent_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_qr_scans_queue ON restaurant_qr_scans(status,created_at);
CREATE INDEX IF NOT EXISTS restaurant_qr_scans_customer ON restaurant_qr_scans(customer_id,menu_id);
CREATE TABLE IF NOT EXISTS restaurant_qr_scan_photos(
 id uuid PRIMARY KEY, scan_id uuid NOT NULL REFERENCES restaurant_qr_scans(id) ON DELETE CASCADE,
 sha256 text NOT NULL, bytes integer NOT NULL, width integer NOT NULL,height integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(scan_id,sha256)
);
