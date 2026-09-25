-- ============================================================================
-- 003 - Table/order concurrency, transfer audit, and layout metadata
-- ============================================================================

ALTER TABLE restaurant_tables ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE order_items ADD COLUMN origin_item_id TEXT REFERENCES order_items(id);
ALTER TABLE order_items ADD COLUMN transfer_group_id TEXT;
ALTER TABLE order_items ADD COLUMN is_gift INTEGER NOT NULL DEFAULT 0 CHECK (is_gift IN (0,1));
ALTER TABLE order_items ADD COLUMN gift_campaign_id TEXT;
ALTER TABLE order_items ADD COLUMN original_price_minor INTEGER;

CREATE TABLE table_transfer_events (
    id                   TEXT PRIMARY KEY,
    operation            TEXT NOT NULL
                         CHECK (operation IN ('move','swap','merge','split','item_transfer','layout')),
    source_table_id      TEXT REFERENCES restaurant_tables(id),
    target_table_id      TEXT REFERENCES restaurant_tables(id),
    source_order_id      TEXT REFERENCES orders(id),
    target_order_id      TEXT REFERENCES orders(id),
    actor_user_id        TEXT REFERENCES users(id),
    idempotency_key      TEXT UNIQUE,
    request_json         TEXT NOT NULL DEFAULT '{}',
    result_json          TEXT NOT NULL DEFAULT '{}',
    source_row_version   INTEGER,
    target_row_version   INTEGER,
    created_at           INTEGER NOT NULL
);

CREATE INDEX idx_table_transfer_events_created
    ON table_transfer_events(created_at);

CREATE INDEX idx_order_items_origin ON order_items(origin_item_id);
CREATE INDEX idx_order_items_transfer_group ON order_items(transfer_group_id);
