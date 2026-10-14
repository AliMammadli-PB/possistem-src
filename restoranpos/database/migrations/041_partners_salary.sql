-- Partners, tabs and salaries (1.7.22).
--
-- Only new columns and one new table: nothing existing is rebuilt.
--
--   ingredients.sale_price_minor - what one unit sells for, so the store can
--       show what its stock is worth at the till and the margin on it.
--   customers.kind / salary_minor - a partner can be a guest or an employee;
--       an employee has a monthly salary their tab is taken out of.
--   orders.account_minor - the part of a bill left on the partner's tab
--       ("nisyə") when the order was closed. Counted as settled, not as cash.
--   salary_payments - advances and full payments, per employee and month.

ALTER TABLE ingredients ADD COLUMN sale_price_minor INTEGER NOT NULL DEFAULT 0
    CHECK (sale_price_minor >= 0);

ALTER TABLE customers ADD COLUMN kind TEXT NOT NULL DEFAULT 'customer'
    CHECK (kind IN ('customer','employee'));
ALTER TABLE customers ADD COLUMN salary_minor INTEGER NOT NULL DEFAULT 0
    CHECK (salary_minor >= 0);

ALTER TABLE orders ADD COLUMN account_minor INTEGER NOT NULL DEFAULT 0
    CHECK (account_minor >= 0);

CREATE TABLE IF NOT EXISTS salary_payments (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    -- The salary month this counts against, 'YYYY-MM' in local time.
    month         TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('advance','full','note')),
    amount_minor  INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_salary_payments ON salary_payments(customer_id, month);
