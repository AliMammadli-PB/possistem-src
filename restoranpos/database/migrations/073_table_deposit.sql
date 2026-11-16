-- 1.10.32. A table can carry a deposit (a banquet room, a VIP table): a minimum the bill is raised to.
-- A new bill on that table takes it over as orders.deposit_minor; the cashier may lower or clear it at payment.
ALTER TABLE restaurant_tables ADD COLUMN deposit_minor INTEGER NOT NULL DEFAULT 0 CHECK (deposit_minor >= 0);
