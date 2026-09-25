-- ============================================================================
-- 005 - Gift campaigns with tiers, day/time windows, and order linkage
-- ============================================================================

CREATE TABLE gift_campaigns (
    id                    TEXT PRIMARY KEY,
    name_az               TEXT NOT NULL,
    name_tr               TEXT NOT NULL DEFAULT '',
    name_en               TEXT NOT NULL DEFAULT '',
    active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    starts_at             INTEGER,
    ends_at               INTEGER,
    min_order_minor       INTEGER NOT NULL DEFAULT 0 CHECK (min_order_minor >= 0),
    review_required       INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0,1)),
    stackable             INTEGER NOT NULL DEFAULT 0 CHECK (stackable IN (0,1)),
    max_gifts_per_order   INTEGER NOT NULL DEFAULT 1 CHECK (max_gifts_per_order >= 1),
    note                  TEXT NOT NULL DEFAULT '',
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

CREATE TABLE gift_campaign_tiers (
    id                TEXT PRIMARY KEY,
    campaign_id       TEXT NOT NULL REFERENCES gift_campaigns(id) ON DELETE CASCADE,
    threshold_minor   INTEGER NOT NULL CHECK (threshold_minor >= 0),
    gift_item_id      TEXT NOT NULL REFERENCES menu_items(id),
    quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (campaign_id, threshold_minor, gift_item_id)
);

CREATE INDEX idx_gift_tiers_campaign ON gift_campaign_tiers(campaign_id, threshold_minor);

CREATE TABLE gift_campaign_windows (
    id            TEXT PRIMARY KEY,
    campaign_id   TEXT NOT NULL REFERENCES gift_campaigns(id) ON DELETE CASCADE,
    day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_minute  INTEGER NOT NULL DEFAULT 0 CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute    INTEGER NOT NULL DEFAULT 1439 CHECK (end_minute BETWEEN 0 AND 1439),
    CHECK (end_minute >= start_minute)
);

CREATE INDEX idx_gift_windows_campaign ON gift_campaign_windows(campaign_id);

CREATE TABLE order_gifts (
    id                    TEXT PRIMARY KEY,
    order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    campaign_id           TEXT NOT NULL REFERENCES gift_campaigns(id),
    tier_id               TEXT REFERENCES gift_campaign_tiers(id),
    gift_item_id          TEXT NOT NULL REFERENCES menu_items(id),
    order_item_id         TEXT REFERENCES order_items(id),
    original_price_minor  INTEGER NOT NULL DEFAULT 0,
    charged_price_minor   INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'eligible'
                          CHECK (status IN ('eligible','selected','applied','review_required',
                                            'approved','rejected','voided')),
    reviewed_by           TEXT REFERENCES users(id),
    reviewed_at           INTEGER,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

CREATE INDEX idx_order_gifts_order ON order_gifts(order_id);
CREATE INDEX idx_order_gifts_campaign ON order_gifts(campaign_id);

ALTER TABLE orders ADD COLUMN gift_review_status TEXT NOT NULL DEFAULT 'none'
    CHECK (gift_review_status IN ('none','required','approved','rejected'));
