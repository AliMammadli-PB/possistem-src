-- Bayi (reseller) panelleri: her bayinin kendi giriş linki + key kotası.
-- Bayi hiçbir zaman silinmez (satış geçmişi korunur) — sadece active=false yapılır.

CREATE TABLE IF NOT EXISTS resellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  phone text,
  key_quota integer NOT NULL DEFAULT 0,
  keys_used integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resellers_email_uidx ON resellers (lower(email));

-- reseller_id NULL => super adminin doğrudan satışı.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS reseller_id uuid REFERENCES resellers(id) ON DELETE SET NULL;

ALTER TABLE activation_keys
  ADD COLUMN IF NOT EXISTS reseller_id uuid REFERENCES resellers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customers_reseller_idx ON customers (reseller_id);
CREATE INDEX IF NOT EXISTS activation_keys_reseller_idx ON activation_keys (reseller_id);
