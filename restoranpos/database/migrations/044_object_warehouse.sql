-- Each branch (obyekt) has its own store room (1.7.26): purchases and returns
-- name the branch, the goods go into or out of its warehouse, and a sale rung
-- up on a branch's till takes its dishes out of that branch's stock.
ALTER TABLE cash_objects ADD COLUMN warehouse_id TEXT REFERENCES warehouses(id);
