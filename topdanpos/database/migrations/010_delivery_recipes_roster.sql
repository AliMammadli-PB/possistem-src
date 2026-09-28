-- The three things a market POS was missing: orders that leave the shop,
-- recipes for anything made in-house, and a roster to plan staff against.

-- ------------------------------------------------------------------ delivery
CREATE TABLE IF NOT EXISTS couriers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  user_id    TEXT,
  vehicle    TEXT NOT NULL DEFAULT '' CHECK (vehicle IN ('','walk','bike','moto','car')),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL
);

-- A delivery is a sale with a destination, not a different kind of sale: it
-- points at the sale so revenue and stock stay in one place.
CREATE TABLE IF NOT EXISTS delivery_orders (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL UNIQUE,
  customer_id  TEXT,
  courier_id   TEXT REFERENCES couriers(id),
  address      TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  fee_minor    INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','assigned','picked_up','delivered','failed','cancelled')),
  assigned_at  INTEGER,
  delivered_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_delivery_status ON delivery_orders(status, created_at);

CREATE TABLE IF NOT EXISTS delivery_events (
  id          TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  courier_id  TEXT,
  note        TEXT NOT NULL DEFAULT '',
  actor_id    TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- ------------------------------------------------------------------- recipes
-- What one unit of a made-up product consumes: a deli tray, a coffee, a bakery
-- item. Quantities are thousandths, so 0.333 kg three times is exactly 0.999.
CREATE TABLE IF NOT EXISTS product_recipes (
  product_id    TEXT NOT NULL,
  component_id  TEXT NOT NULL,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  PRIMARY KEY (product_id, component_id),
  CHECK (product_id != component_id)
);

-- -------------------------------------------------------------------- roster
CREATE TABLE IF NOT EXISTS staff_schedules (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  role_note   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','confirmed','cancelled')),
  created_at  INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_market_schedule ON staff_schedules(user_id, starts_at);

CREATE TABLE IF NOT EXISTS attendance (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  schedule_id  TEXT REFERENCES staff_schedules(id),
  clock_in_at  INTEGER NOT NULL,
  clock_out_at INTEGER,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

-- One open punch per person: clocking in twice is a mistake, not a second shift.
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_attendance_open
  ON attendance(user_id) WHERE clock_out_at IS NULL;

INSERT OR IGNORE INTO permission_catalogue(permission, grp, label) VALUES
  ('DELIVERY_VIEW',   'catdirilma', 'Çatdırılmaları görmək'),
  ('DELIVERY_MANAGE', 'catdirilma', 'Çatdırılma və kuryer idarəsi'),
  ('DELIVERY_ASSIGN', 'catdirilma', 'Kuryer təyin etmək'),
  ('EDIT_RECIPE',     'menyu',      'Resept redaktə etmək'),
  ('SCHEDULE_VIEW',   'sistem',     'İş qrafikinə baxmaq'),
  ('SCHEDULE_MANAGE', 'sistem',     'İş qrafikini planlamaq'),
  ('SCHEDULE_CLOCK',  'sistem',     'İşə giriş/çıxış qeyd etmək');

INSERT OR IGNORE INTO role_permissions(role, permission) VALUES
  ('cashier',   'DELIVERY_VIEW'),   ('cashier',   'DELIVERY_ASSIGN'),
  ('cashier',   'SCHEDULE_VIEW'),   ('cashier',   'SCHEDULE_CLOCK'),
  ('warehouse', 'DELIVERY_VIEW'),   ('warehouse', 'EDIT_RECIPE'),
  ('warehouse', 'SCHEDULE_VIEW'),   ('warehouse', 'SCHEDULE_CLOCK');

-- The manager holds every permission there is, including the ones just added.
INSERT OR IGNORE INTO role_permissions(role, permission)
SELECT 'manager', permission FROM permission_catalogue;
