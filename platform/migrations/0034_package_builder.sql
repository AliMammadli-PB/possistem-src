-- Website package builder document (features, prices, texts). The API also
-- creates this on first use (apps/api/src/routes/package-builder.ts).
CREATE TABLE IF NOT EXISTS package_builder (
  id text PRIMARY KEY,
  content jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
