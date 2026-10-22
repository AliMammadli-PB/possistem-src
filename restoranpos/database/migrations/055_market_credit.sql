ALTER TABLE customers ADD COLUMN credit_allowed INTEGER NOT NULL DEFAULT 0 CHECK(credit_allowed IN(0,1));
ALTER TABLE customers ADD COLUMN credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit_minor>=0);
CREATE TABLE market_customer_events (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, amount_minor INTEGER NOT NULL, created_at INTEGER NOT NULL);
