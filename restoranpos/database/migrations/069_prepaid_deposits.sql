ALTER TABLE payments ADD COLUMN is_deposit INTEGER NOT NULL DEFAULT 0 CHECK (is_deposit IN (0,1));
ALTER TABLE orders ADD COLUMN prepaid_deposit_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN minimum_table_minor INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_payment_one_deposit ON payments(order_id)
    WHERE is_deposit=1 AND status NOT IN ('declined','canceled','failed');
CREATE UNIQUE INDEX idx_deposit_bank_rrn ON payments(bank_rrn) WHERE is_deposit=1 AND bank_rrn IS NOT NULL;
