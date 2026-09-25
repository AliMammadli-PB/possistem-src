-- Milioner 1.2.2: a manually entered, positive deposit/surcharge.
--
-- It is deliberately stored separately from subtotal/service/tax.  The final
-- order total is base total + deposit, so a 34 AZN bill with a 6 AZN deposit
-- is collected as 40 AZN without charging service or tax on the deposit.
ALTER TABLE orders ADD COLUMN deposit_minor INTEGER NOT NULL DEFAULT 0
    CHECK (deposit_minor >= 0);

