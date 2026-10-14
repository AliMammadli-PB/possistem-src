-- Expired lots leave usable stock (1.7.29).
--
-- Until now first-expiring-first-out only put expired lots last, so a store
-- short of good stock still used them. From now on a lot past its date is
-- blocked the moment anything touches its ingredient (or a stock screen is
-- opened): its quantity is written off the balance as "Vaxtı keçib" and it
-- can no longer be used. The lot keeps its quantity so the staff know what to
-- throw away; correcting a wrong expiry date brings it back.

ALTER TABLE stock_lots ADD COLUMN blocked_at INTEGER;
