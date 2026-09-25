-- ============================================================================
-- 009 - Auto-opening business days, business_day_id backfill, merge repair
--
-- Three defects are addressed here:
--
-- 1. A till could not be reopened on the same calendar date. 002 put a UNIQUE
--    index on business_days.business_date, so after a Z close the restaurant
--    was locked out of trading until local midnight.
--
-- 2. business_day_id was never written on orders/payments, so every X and Z
--    report aggregated to zero. The stamping is fixed in C++; this backfills
--    the history that was written while the bug was live.
--
-- 3. tables.merge set restaurant_tables.merged_into_id and closed the source
--    order without recalculating it. Nothing ever cleared the flag, and the
--    stale totals on the closed source made every merged bill count twice in
--    SUM(total_minor) over ('paid','closed').
-- ============================================================================

-- ---------------------------------------------------------------- 1. indexes
-- A standalone CREATE UNIQUE INDEX, so DROP INDEX suffices: no table rebuild,
-- no CHECK constraint involved.
DROP INDEX IF EXISTS idx_business_days_date;

-- Reports still look days up by date, so keep a lookup index - just not unique.
CREATE INDEX IF NOT EXISTS idx_business_days_date
    ON business_days(business_date);

-- Backs openBusinessDayId() and the "latest day" fallback in current().
-- NOTE: idx_business_days_one_open is deliberately untouched. After this
-- migration it is the ONLY guarantee that at most one day is open at a time.
CREATE INDEX IF NOT EXISTS idx_business_days_status_opened
    ON business_days(status, opened_at);

-- --------------------------------------------------------------- 2. backfill
-- An already-closed archive day to hold rows that fall outside every real
-- business day window. Created only when there is something to put in it, so
-- the assignments below can never reference a missing row.
INSERT INTO business_days (
    id, business_date, status, opened_at, closed_at, opened_by, closed_by,
    opening_float_minor, note, legacy, created_at, updated_at
)
SELECT
    'bday-archive-v1',
    COALESCE(
        (SELECT date(MIN(opened_at) / 1000, 'unixepoch', 'localtime')
         FROM orders WHERE business_day_id IS NULL),
        date('now', 'localtime')
    ),
    'closed',
    COALESCE((SELECT MIN(opened_at) FROM orders WHERE business_day_id IS NULL),
             CAST(strftime('%s','now') AS INTEGER) * 1000),
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    NULL,
    NULL,
    0,
    'Archive bucket created during the 009 business_day_id backfill',
    1,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM orders         WHERE business_day_id IS NULL)
   OR EXISTS (SELECT 1 FROM payments       WHERE business_day_id IS NULL)
   OR EXISTS (SELECT 1 FROM refunds        WHERE business_day_id IS NULL)
   OR EXISTS (SELECT 1 FROM cash_movements WHERE business_day_id IS NULL)
   OR EXISTS (SELECT 1 FROM shifts         WHERE business_day_id IS NULL);

-- Orders: attach to the day whose [opened_at, closed_at] window contains the
-- order's opened_at. Newest match wins so a still-open day beats a stale one.
UPDATE orders
SET business_day_id = (
    SELECT d.id FROM business_days d
    WHERE d.id <> 'bday-archive-v1'
      AND orders.opened_at >= d.opened_at
      AND (d.closed_at IS NULL OR orders.opened_at <= d.closed_at)
    ORDER BY d.opened_at DESC
    LIMIT 1)
WHERE business_day_id IS NULL;

UPDATE orders SET business_day_id = 'bday-archive-v1' WHERE business_day_id IS NULL;

-- Payments: prefer the parent order's day, so a bill and the money paid against
-- it can never be split across two different Z reports.
UPDATE payments
SET business_day_id = (
    SELECT o.business_day_id FROM orders o WHERE o.id = payments.order_id)
WHERE business_day_id IS NULL;

UPDATE payments
SET business_day_id = (
    SELECT d.id FROM business_days d
    WHERE d.id <> 'bday-archive-v1'
      AND payments.created_at >= d.opened_at
      AND (d.closed_at IS NULL OR payments.created_at <= d.closed_at)
    ORDER BY d.opened_at DESC
    LIMIT 1)
WHERE business_day_id IS NULL;

UPDATE payments SET business_day_id = 'bday-archive-v1' WHERE business_day_id IS NULL;

-- Refunds follow their payment (RefundService already does this for new rows).
UPDATE refunds
SET business_day_id = (
    SELECT p.business_day_id FROM payments p WHERE p.id = refunds.payment_id)
WHERE business_day_id IS NULL;

UPDATE refunds SET business_day_id = 'bday-archive-v1' WHERE business_day_id IS NULL;

UPDATE cash_movements
SET business_day_id = (
    SELECT d.id FROM business_days d
    WHERE d.id <> 'bday-archive-v1'
      AND cash_movements.created_at >= d.opened_at
      AND (d.closed_at IS NULL OR cash_movements.created_at <= d.closed_at)
    ORDER BY d.opened_at DESC
    LIMIT 1)
WHERE business_day_id IS NULL;

UPDATE cash_movements SET business_day_id = 'bday-archive-v1' WHERE business_day_id IS NULL;

UPDATE shifts
SET business_day_id = (
    SELECT d.id FROM business_days d
    WHERE d.id <> 'bday-archive-v1'
      AND shifts.opened_at >= d.opened_at
      AND (d.closed_at IS NULL OR shifts.opened_at <= d.closed_at)
    ORDER BY d.opened_at DESC
    LIMIT 1)
WHERE business_day_id IS NULL;

UPDATE shifts SET business_day_id = 'bday-archive-v1' WHERE business_day_id IS NULL;

-- ------------------------------------------------------- 3. merge dead state
-- The old tables.merge set merged_into_id and no code path ever cleared it, so
-- every table ever used as a merge source carries a permanent pointer. The new
-- merge sets it on merge and clears it when the target bill is closed; start
-- everyone from a clean slate.
UPDATE restaurant_tables
SET merged_into_id = NULL,
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE merged_into_id IS NOT NULL;

-- --------------------------------------------- 4. merge double-count cleanup
-- Historical merge sources were force-closed with their pre-merge totals still
-- on the row while their items had already moved to the target, so reports
-- counted the same food twice. Zero any closed order that has no non-voided
-- items and no approved/refunded payments - which is exactly what
-- OrderService::recalculate() would now compute for it.
UPDATE orders
SET subtotal_minor = 0,
    discount_minor = 0,
    tax_minor      = 0,
    service_minor  = 0,
    total_minor    = 0,
    paid_minor     = 0,
    tip_minor      = 0,
    updated_at     = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE status = 'closed'
  AND total_minor > 0
  AND NOT EXISTS (SELECT 1 FROM order_items i
                  WHERE i.order_id = orders.id AND i.status <> 'voided')
  AND NOT EXISTS (SELECT 1 FROM payments p
                  WHERE p.order_id = orders.id AND p.status IN ('approved','refunded'));
