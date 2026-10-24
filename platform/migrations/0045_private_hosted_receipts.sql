-- Real hosted-invoice receipts, manually checked in the merchant dashboard.
-- These are never simulator results or subscription period grants.
CREATE TABLE billing_private_hosted_receipts (
 invoice_url_sha256 text PRIMARY KEY CHECK(invoice_url_sha256 ~ '^[a-f0-9]{64}$'),
 product_id text NOT NULL REFERENCES billing_test_products(id),
 provider_invoice_id text NOT NULL UNIQUE,
 provider_transaction_id text NOT NULL UNIQUE,
 amount_minor integer NOT NULL CHECK(amount_minor > 0),
 currency text NOT NULL DEFAULT 'AZN' CHECK(currency='AZN'),
 paid_at timestamptz NOT NULL,
 verification_source text NOT NULL CHECK(verification_source='epoint_merchant_dashboard'),
 verified_at timestamptz NOT NULL DEFAULT now()
);
