CREATE TABLE IF NOT EXISTS contact_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new',
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_leads_status_check
    CHECK (status IN ('new', 'contacted', 'qualified', 'closed'))
);

CREATE INDEX IF NOT EXISTS contact_leads_created_at_idx
  ON contact_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS contact_leads_status_idx
  ON contact_leads (status, created_at DESC);
