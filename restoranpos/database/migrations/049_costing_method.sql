-- Weighted average cost next to the last price paid (1.7.28).
--
-- ingredients.cost_minor stays "last price paid, landed"; avg_cost_minor is
-- the perpetual weighted average kept on every receipt. Which one recipes and
-- reports use is the setting inventory.costingMethod: average | fifo | last.

ALTER TABLE ingredients ADD COLUMN avg_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_minor >= 0);
UPDATE ingredients SET avg_cost_minor = cost_minor;

INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at)
VALUES ('inventory.costingMethod', 'average', 'string', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
