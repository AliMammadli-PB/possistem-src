-- Partners (bayi) pay POSSISTEM per month of licence they sell.
--
-- resellers.key_quota / keys_used keep their columns and change their unit:
-- from "customers a partner may create" to "months of licence". A 1-month sale
-- spends 1, a 12-month sale 12, and renewing spends again. Every movement is a
-- row in reseller_credit_ledger, so what a partner bought, spent and got back
-- can always be explained.
--
-- Additive only. Existing licences keep their dates; no partner has spent any
-- quota yet, so reading the old numbers as months changes nobody's balance.

ALTER TABLE resellers ADD COLUMN IF NOT EXISTS trial_limit integer NOT NULL DEFAULT 5;
ALTER TABLE resellers ADD COLUMN IF NOT EXISTS max_devices integer NOT NULL DEFAULT 3;
-- Sessions issued before this are refused: resetting a password signs the partner out everywhere.
ALTER TABLE resellers ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS term_months integer;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS reseller_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id uuid NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  -- + credits granted or returned, - credits spent
  delta integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('grant', 'sale', 'renew', 'refund', 'adjust')),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  license_id uuid REFERENCES licenses(id) ON DELETE SET NULL,
  months integer,
  -- what the partner paid POSSISTEM for a grant, in qəpik; NULL when not recorded
  amount_minor bigint,
  note text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reseller_credit_ledger_reseller_idx
  ON reseller_credit_ledger (reseller_id, created_at DESC);

-- The code already reports a duplicate partner e-mail as this index; it existed
-- only on the server. Guarded so an existing duplicate cannot fail the migration.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resellers GROUP BY lower(email) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS resellers_email_uidx ON resellers (lower(email));
  END IF;
END $$;
