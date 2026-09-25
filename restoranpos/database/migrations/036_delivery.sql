-- Orders that leave the building.
--
-- A delivery is an order with a destination and a courier, not a separate kind
-- of sale: it reuses orders, payments and the kitchen exactly as a table bill
-- does, so revenue and stock stay in one place.
CREATE TABLE IF NOT EXISTS couriers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL DEFAULT '',
    -- A courier may also be a member of staff who signs in at the till.
    user_id      TEXT REFERENCES users(id),
    vehicle      TEXT NOT NULL DEFAULT '' CHECK (vehicle IN ('','walk','bike','moto','car')),
    active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_orders (
    id             TEXT PRIMARY KEY,
    order_id       TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    customer_id    TEXT REFERENCES customers(id),
    courier_id     TEXT REFERENCES couriers(id),
    address        TEXT NOT NULL,
    phone          TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    -- Charged to the guest on top of the bill.
    fee_minor      INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','assigned','picked_up','delivered',
                                     'failed','cancelled')),
    assigned_at    INTEGER,
    picked_up_at   INTEGER,
    delivered_at   INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_courier ON delivery_orders(courier_id, created_at);

-- Every status change, so "who had it and when" survives a shift change.
CREATE TABLE IF NOT EXISTS delivery_events (
    id            TEXT PRIMARY KEY,
    delivery_id   TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
    status        TEXT NOT NULL,
    courier_id    TEXT REFERENCES couriers(id),
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);
