CREATE TABLE IF NOT EXISTS restaurant_qr_models(
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 menu_id uuid NOT NULL REFERENCES restaurant_qr_menus(id) ON DELETE CASCADE,
 product_id text NOT NULL,option_ids jsonb NOT NULL DEFAULT '[]',
 width_cm numeric NOT NULL CHECK(width_cm BETWEEN 1 AND 200),metadata jsonb NOT NULL,
 published boolean NOT NULL DEFAULT false,version uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_qr_models_menu ON restaurant_qr_models(menu_id,product_id);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_qr_models_published ON restaurant_qr_models(menu_id,product_id,option_ids) WHERE published;
