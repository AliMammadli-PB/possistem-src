ALTER TABLE document_cash_links ADD COLUMN salary_adjustment_id TEXT REFERENCES customer_ledger(id);

-- Backfill only when the original transaction identifies exactly one pair.
UPDATE document_cash_links AS link
SET salary_adjustment_id = (
  SELECT CASE WHEN COUNT(*)=1 THEN MIN(l.id) END
  FROM salary_payments p JOIN customer_ledger l
    ON l.customer_id=p.customer_id AND l.created_at=p.created_at AND l.actor_user_id IS p.actor_user_id
  WHERE p.id=link.doc_id AND p.kind='full' AND l.kind='adjustment' AND l.note='Maaşdan tutuldu'
    AND NOT EXISTS (
      SELECT 1 FROM salary_payments other WHERE other.id<>p.id AND other.kind='full'
        AND other.customer_id=p.customer_id AND other.created_at=p.created_at AND other.actor_user_id IS p.actor_user_id
    )
)
WHERE link.doc_type='salary';

CREATE TABLE cash_transfer_documents (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES cash_accounts(id),
    to_id TEXT NOT NULL REFERENCES cash_accounts(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    actor_user_id TEXT,
    CHECK (from_id <> to_id)
);

-- The original implementation stored each transfer as exactly two ledger legs.
INSERT INTO cash_transfer_documents(id,from_id,to_id,amount_minor,note,created_at,actor_user_id)
SELECT a.ref_id,a.account_id,b.account_id,b.amount_minor,a.note,a.created_at,a.actor_user_id
FROM cash_account_moves a JOIN cash_account_moves b ON b.ref_id=a.ref_id AND b.ref_type='transfer'
WHERE a.ref_type='transfer' AND a.ref_id<>'' AND a.amount_minor<0 AND b.amount_minor=-a.amount_minor
  AND a.account_id<>b.account_id
  AND (SELECT COUNT(*) FROM cash_account_moves m WHERE m.ref_type='transfer' AND m.ref_id=a.ref_id)=2;
