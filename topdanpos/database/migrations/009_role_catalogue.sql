-- A name and a description for every permission, so the roles screen can show
-- something an operator understands instead of SALE_REFUND.
--
-- The grants themselves already live in role_permissions; this only describes
-- the keys. `custom` marks roles an operator created, so the shipped three keep
-- their guarantees.
CREATE TABLE IF NOT EXISTS permission_catalogue (
  permission TEXT PRIMARY KEY,
  grp        TEXT NOT NULL DEFAULT 'other',
  label      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roles (
  role        TEXT PRIMARY KEY,
  label       TEXT NOT NULL DEFAULT '',
  custom      INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0,1))
);

INSERT OR IGNORE INTO roles(role, label, custom) VALUES
  ('manager',   'Müdir',   0),
  ('cashier',   'Kassir',  0),
  ('warehouse', 'Anbardar',0);

INSERT OR IGNORE INTO permission_catalogue(permission, grp, label) VALUES
  ('SALE_DISCOUNT',    'satis',    'Endirim tətbiq etmək'),
  ('SALE_CANCEL',      'satis',    'Satışı ləğv etmək'),
  ('SALE_REFUND',      'satis',    'Geri qaytarma'),
  ('PARTIAL_REFUND',   'satis',    'Qismən geri qaytarma'),
  ('PRICE_OVERRIDE',   'satis',    'Qiyməti dəyişmək'),
  ('HOLD_CANCEL',      'satis',    'Gözləyən satışı ləğv etmək'),
  ('OPEN_DRAWER',      'kassa',    'Kassa şüşəsini açmaq'),
  ('CASH_IN',          'kassa',    'Kassaya pul girişi'),
  ('CASH_OUT',         'kassa',    'Kassadan pul çıxışı'),
  ('SAFE_DROP',        'kassa',    'Seyfə köçürmə'),
  ('CLOSE_SHIFT',      'kassa',    'Növbəni bağlamaq'),
  ('CREATE_PRODUCT',   'menyu',    'Məhsul yaratmaq'),
  ('EDIT_PRODUCT',     'menyu',    'Məhsulu redaktə etmək'),
  ('EDIT_PRICE',       'menyu',    'Qiyməti dəyişmək'),
  ('VIEW_COST',        'menyu',    'Maya dəyərini görmək'),
  ('EDIT_STOCK',       'anbar',    'Stoku dəyişmək'),
  ('STOCK_ADJUSTMENT', 'anbar',    'Stok düzəlişi'),
  ('RECEIVE_PURCHASE', 'anbar',    'Mal qəbulu'),
  ('TRANSFER_STOCK',   'anbar',    'Anbarlararası transfer'),
  ('VIEW_REPORTS',     'hesabat',  'Hesabatlara baxmaq'),
  ('VIEW_PROFIT',      'hesabat',  'Mənfəəti görmək'),
  ('MANAGE_USERS',     'sistem',   'İstifadəçiləri idarə etmək'),
  ('MANAGE_SETTINGS',  'sistem',   'Tənzimləmələri dəyişmək'),
  ('MANAGE_ROLES',     'sistem',   'Rol və səlahiyyətləri idarə etmək');

-- The manager holds every permission there is, including any added later:
-- without this, granting a right the manager lacked would leave nobody able to
-- take it back.
INSERT OR IGNORE INTO role_permissions(role, permission)
SELECT 'manager', permission FROM permission_catalogue;
