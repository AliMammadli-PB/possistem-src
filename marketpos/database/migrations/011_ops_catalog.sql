-- 1.5.0: goods come from Əməliyyatlar → Mallar (the shared warehouse system).
-- Products made there carry ids "ops-<good>". The old catalogue stays in the
-- database for history (sales, returns) but leaves the selling screen; the
-- shop fills Mallar by Excel import or by hand.
UPDATE products SET active = 0 WHERE id NOT LIKE 'ops-%';
