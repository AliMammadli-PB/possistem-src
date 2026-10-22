-- Login-only artifacts are hidden; real payroll and every financial history remain partners.
ALTER TABLE customers ADD COLUMN partner_origin TEXT NOT NULL DEFAULT 'partner';
UPDATE customers SET partner_origin='market_login'
WHERE id LIKE 'mstaff-%' AND salary_minor=0 AND debt_minor=0
AND NOT EXISTS (SELECT 1 FROM salary_payments WHERE customer_id=customers.id)
AND NOT EXISTS (SELECT 1 FROM customer_ledger WHERE customer_id=customers.id);
