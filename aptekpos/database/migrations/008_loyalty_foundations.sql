-- Bonus (loyalty) card foundations.
--
-- The earn/redeem money path already worked, but nothing around it did: a card
-- could not be scanned, the default rate made every sale earn zero, the cashier
-- standing at the till was the one role not allowed to redeem, and the balance
-- query had no index behind it. This migration fixes the data layer for all four.

-- A bonus card must identify exactly one customer. Without this a scanned card
-- could match two rows and credit the wrong person's balance; the column has
-- carried no constraint since it was introduced.
CREATE UNIQUE INDEX IF NOT EXISTS customers_loyalty_card_idx
  ON customers(loyalty_card)
  WHERE loyalty_card IS NOT NULL AND loyalty_card <> '';

-- Every balance read is "newest ledger row for this customer". customer_ledger
-- got that index; loyalty_ledger was left to scan the whole table on each sale.
CREATE INDEX IF NOT EXISTS loyalty_ledger_customer_idx
  ON loyalty_ledger(customer_id, created_at);

-- Redemption was granted to manager and head_cashier only, so the person who
-- actually serves the customer could never apply their bonus — and the sale
-- screen has no manager-approval flow to escalate through. A cashier taking
-- bonus off a total is ordinary counter work, not a privileged override.
INSERT OR IGNORE INTO role_permissions(role, permission) VALUES ('cashier', 'LOYALTY_REDEEM');

-- Ship 1% rather than 0%. The control plane already provisions new customers at
-- 1.00% and overwrites this on every heartbeat, so the old '0' only ever applied
-- before the first heartbeat — and on trial tills, which never heartbeat, it
-- meant the bonus feature silently never worked at all.
UPDATE settings SET value = '100' WHERE key = 'loyaltyRateBps' AND value = '0';

-- `loyaltyEnabled` was seeded but never read by a single line of code; the till
-- derives "enabled" from the rate being above zero. Drop the dead switch so it
-- cannot be mistaken for a working toggle.
DELETE FROM settings WHERE key = 'loyaltyEnabled';
