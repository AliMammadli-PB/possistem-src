CREATE TABLE IF NOT EXISTS site_visits (
  id bigserial PRIMARY KEY,
  ip text NOT NULL,
  path text NOT NULL DEFAULT '/',
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_visits_seen_idx ON site_visits (seen_at DESC);
