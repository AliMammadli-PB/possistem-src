-- ============================================================================
-- 011 - Void ghost open orders left by the tables.swap statement-cache bug
--
-- A buggy park-to-NULL + dual prepare of the same UPDATE text left open
-- orders with table_id IS NULL. Readiness counted them; the floor plan did
-- not. Void those orphans and clear stale table statuses that no longer have
-- a live order.
-- ============================================================================

UPDATE orders
SET status = 'voided',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    row_version = row_version + 1
WHERE table_id IS NULL
  AND status IN ('draft', 'open', 'sent', 'partially_paid');

-- Tables stuck in occupied/ordering/etc. with no live order → available.
-- Mirrors OrderService::refreshTableStatus when openOrderIdForTable is empty.
UPDATE restaurant_tables
SET status = 'available',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    row_version = row_version + 1
WHERE status IN (
        'ordering', 'occupied', 'preparing', 'ready', 'payment_requested', 'waiting'
    )
  AND merged_into_id IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.table_id = restaurant_tables.id
          AND o.status IN ('draft', 'open', 'sent', 'partially_paid')
    );
