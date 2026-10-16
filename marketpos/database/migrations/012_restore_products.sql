-- 1.5.2: the products 011 took off the selling screen come back. Only the
-- ones a person deleted (PRODUCT_DELETE in the audit log) stay hidden. The
-- warehouse PC then copies them into Əməliyyatlar → Mallar once, linked to
-- these same products (electron/ops-engine.cjs), so nothing is doubled.
UPDATE products SET active = 1
WHERE id NOT LIKE 'ops-%' AND active = 0
  AND id NOT IN (SELECT detail FROM audit_logs WHERE action = 'PRODUCT_DELETE');
