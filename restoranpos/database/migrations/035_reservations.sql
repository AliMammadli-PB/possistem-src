-- Table bookings.
--
-- A reservation holds a table for a window of time; it does not open an order.
-- Seating the guest is what creates the bill, and that link is kept so a no-show
-- can be told apart from a booking that turned into a sale.
CREATE TABLE IF NOT EXISTS reservations (
    id            TEXT PRIMARY KEY,
    table_id      TEXT REFERENCES restaurant_tables(id),
    customer_id   TEXT REFERENCES customers(id),
    guest_name    TEXT NOT NULL DEFAULT '',
    guest_phone   TEXT NOT NULL DEFAULT '',
    party_size    INTEGER NOT NULL DEFAULT 2 CHECK (party_size > 0),
    starts_at     INTEGER NOT NULL,
    duration_min  INTEGER NOT NULL DEFAULT 90 CHECK (duration_min > 0),
    status        TEXT NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked','seated','completed','no_show','cancelled')),
    note          TEXT NOT NULL DEFAULT '',
    order_id      TEXT REFERENCES orders(id),
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_when ON reservations(starts_at, status);
CREATE INDEX IF NOT EXISTS idx_reservations_table ON reservations(table_id, starts_at);
