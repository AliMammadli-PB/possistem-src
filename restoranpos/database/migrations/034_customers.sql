-- Guests we know by name: house accounts, debt and loyalty points.
CREATE TABLE IF NOT EXISTS customers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL DEFAULT '',
    address       TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    -- Points, not money: the exchange rate is a setting, not a stored balance.
    loyalty_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    -- What the guest owes right now. A projection of customer_ledger.
    debt_minor    INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS customer_ledger (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    order_id      TEXT REFERENCES orders(id),
    amount_minor  INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('charge','payment','adjustment')),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_ledger ON customer_ledger(customer_id, created_at);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    order_id      TEXT REFERENCES orders(id),
    points        INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('earn','redeem','adjustment')),
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

-- An order may belong to a guest, which is what makes debt and points possible.
ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id);
