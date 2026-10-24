-- Explicit user choice; older orders retain their original consent semantics.
ALTER TABLE billing_orders ADD COLUMN payment_mode text
 CHECK(payment_mode IN ('manual','automatic'));
