-- 0033: Subscription plans (Standart / Biznes / Premium)
-- Additive only — safe to run on a live database.

CREATE TABLE IF NOT EXISTS subscription_plans (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    name_az         text NOT NULL,
    description_az  text,
    features        jsonb NOT NULL DEFAULT '[]',
    monthly_price_minor bigint NOT NULL DEFAULT 0,
    sort_order      int NOT NULL DEFAULT 0,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO subscription_plans (id, name, name_az, description_az, features, sort_order)
VALUES
    ('standart', 'Standart', 'Standart',
     'Əsas POS funksiyaları — sifariş, masa, ödəniş, anbar, hesabat',
     '["pos"]', 1),
    ('biznes', 'Biznes', 'Biznes',
     'POS + komanda söhbəti, bildirişlər, növbə qeydləri',
     '["pos","chat"]', 2),
    ('premium', 'Premium', 'Premium',
     'POS + söhbət + bulud yedəkləmə, avtomatik backup, istənilən cihazdan bərpa',
     '["pos","chat","cloud"]', 3)
ON CONFLICT (id) DO NOTHING;

-- Link licenses to a plan (nullable — existing licenses stay NULL).
DO $$ BEGIN
    ALTER TABLE licenses ADD COLUMN plan_id text REFERENCES subscription_plans(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Default new restaurant licenses to 'standart' going forward.
ALTER TABLE licenses ALTER COLUMN plan_id SET DEFAULT 'standart';
