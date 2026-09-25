-- ============================================================================
-- Reference data every install needs: settings, roles, permissions.
-- Floor plan is intentionally empty — the operator adds halls/tables after setup.
--
-- Deliberately does NOT contain the menu. Files named `*_demo_*` carry the
-- Milioner catalogue and are skipped when POS_SEED_DEMO_MENU=0, so a till sold
-- to a different restaurant does not start life with somebody else's prices.
-- Anything moved in here must be true of every customer.
--
-- Identifiers are readable slugs rather than UUIDs so the seed stays diffable.
-- Demo admin is created by the C++ seeder (PIN hashed with a random salt).
-- Receipt identity (name/address/phone/hours) stays blank until the customer
-- fills settings or activation writes `settings.applyProvisionedIdentity`.
-- ============================================================================

-- --------------------------------------------------------------- settings --
INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at) VALUES
  ('restaurant.name',        '',                                    'string', 0),
  ('restaurant.tagline',     '',                                    'string', 0),
  ('restaurant.address',     '',                                    'string', 0),
  ('restaurant.phone',       '',                                    'string', 0),
  ('restaurant.taxId',       '',                                    'string', 0),
  ('restaurant.hours',       '',                                    'string', 0),
  ('printer.logoDataUrl',    '',                                    'string', 0),
  ('locale.language',        'az',                                'string', 0),
  ('locale.currency',        'AZN',                               'string', 0),
  ('locale.currencyDisplay', 'symbol',                            'string', 0),
  ('locale.currencySymbol',  '₼',                                 'string', 0),
  ('finance.taxPercent',     '0',                                 'int',    0),
  ('finance.servicePercent', '0',                                 'int',    0),
  ('finance.taxIncluded',    '1',                                 'bool',   0),
  ('terminal.id',            'TERM-01',                           'string', 0),
  ('terminal.name',          'Main Till',                         'string', 0),
  ('printer.receipt',        'auto',                              'string', 0),
  ('printer.autoDetect',     '1',                                 'string', 0),
  ('printer.kitchen',        'auto',                              'string', 0),
  ('printer.paperWidth',     '80',                                'int',    0),
  ('printer.charsPerLine58', '28',                                'int',    0),
  ('printer.charsPerLine80', '40',                                'int',    0),
  ('printer.fontHeightPx',   '32',                                'int',    0),
  ('printer.fontWidthPx',    '14',                                'int',    0),
  ('printer.sideMarginPx',   '2',                                 'int',    0),
  ('printer.renderMode',     'raster',                            'string', 0),
  ('printer.codePage',       '13',                                'int',    0),
  ('printer.density',        '5',                                 'int',    0),
  ('printer.bottomFeedLines','4',                                 'int',    0),
  ('printer.cut',            '1',                                 'string', 0),
  ('printer.beep',           '0',                                 'string', 0),
  ('printer.qr',             '1',                                 'string', 0),
  ('printer.openCashDrawer', '0',                                 'string', 0),
  ('printer.printItemUnitPrice', '1',                             'string', 0),
  ('printer.printModifierPrice',  '1',                             'string', 0),
  ('printer.columns',        '48',                                'int',    0),
  ('ui.theme',               'dark-luxury',                       'string', 0),
  ('ui.reduceMotion',        '0',                                 'bool',   0),
  ('ui.touchMode',           '1',                                 'bool',   0),
  ('ui.sounds',              '1',                                 'bool',   0),
  ('security.autoLogoutSeconds', '900',                           'int',    0),
  ('security.maxPinAttempts',    '5',                             'int',    0),
  ('security.lockoutSeconds',    '300',                           'int',    0),
  ('sync.serverUrl',         '',                                  'string', 0),
  ('sync.enabled',           '0',                                 'bool',   0);

-- ------------------------------------------------------------------ roles --
INSERT INTO roles (id, name, description, rank) VALUES
  ('role-waiter',        'waiter',        'Takes orders and serves guests',      10),
  ('role-cashier',       'cashier',       'Handles payments and the till',       20),
  ('role-kitchen',       'kitchen',       'Kitchen display operator',            15),
  ('role-supervisor',    'supervisor',    'Floor supervisor',                    30),
  ('role-manager',       'manager',       'Restaurant manager',                  40),
  ('role-administrator', 'administrator', 'Full system access',                  50);

INSERT OR IGNORE INTO permissions (id, key, description) VALUES
  ('perm-order-create',    'order.create',      'Create orders'),
  ('perm-order-void',      'order.void',        'Void orders and sent items'),
  ('perm-order-discount',  'order.discount',    'Apply discounts'),
  ('perm-order-transfer',  'order.transfer',    'Transfer, merge and split tables'),
  ('perm-order-closeother','order.closeOther',  'Close another employee order'),
  ('perm-order-price',     'order.priceOverride','Override item prices'),
  ('perm-payment-take',    'payment.take',      'Accept payments'),
  ('perm-payment-refund',  'payment.refund',    'Issue refunds'),
  ('perm-payment-recon',   'payment.reconcile', 'Reconcile unknown payments'),
  ('perm-shift-manage',    'shift.manage',      'Open and close shifts'),
  ('perm-kds-operate',     'kds.operate',       'Operate the kitchen display'),
  ('perm-catalog-manage',  'catalog.manage',    'Manage the menu'),
  ('perm-settings-manage', 'settings.manage',   'Change settings'),
  ('perm-audit-view',      'audit.view',        'View the audit log'),
  ('perm-reports-view',    'reports.view',      'View reports'),
  ('perm-business-day',    'businessDay.manage','Open and close business days / Z reports'),
  ('perm-x-report',        'reports.x',         'Generate interim X reports'),
  ('perm-z-report',        'reports.z',         'Generate end-of-day Z reports'),
  ('perm-cash-manage',     'cash.manage',       'Cash in/out and drawer operations'),
  ('perm-gift-manage',     'gifts.manage',      'Configure gift campaigns'),
  ('perm-gift-override',   'gifts.override',    'Approve gift review overrides'),
  ('perm-catalog-import',  'catalog.import',    'Import/export catalog CSV'),
  ('perm-backup-manage',   'backup.manage',     'Create and restore local backups'),
  ('perm-license-manage',  'license.manage',    'Activate and view license status'),
  ('perm-table-layout',    'tables.layout',     'Edit floor plan layout'),
  ('perm-split-bill',      'payment.split',     'Split bills'),
  ('perm-discount-rules',  'discount.manage',   'Manage discount rules'),
  ('perm-users-manage',    'users.manage',      'Create and deactivate local staff');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role-waiter','perm-order-create'), ('role-waiter','perm-order-transfer'),
  ('role-waiter','perm-payment-take'),

  ('role-cashier','perm-order-create'), ('role-cashier','perm-payment-take'),
  ('role-cashier','perm-shift-manage'),
  ('role-cashier','perm-x-report'), ('role-cashier','perm-cash-manage'),
  ('role-cashier','perm-split-bill'),

  ('role-kitchen','perm-kds-operate'),

  ('role-supervisor','perm-order-create'), ('role-supervisor','perm-order-void'),
  ('role-supervisor','perm-order-discount'), ('role-supervisor','perm-order-transfer'),
  ('role-supervisor','perm-payment-take'), ('role-supervisor','perm-payment-recon'),
  ('role-supervisor','perm-shift-manage'), ('role-supervisor','perm-kds-operate'),
  ('role-supervisor','perm-reports-view'),
  ('role-supervisor','perm-x-report'), ('role-supervisor','perm-cash-manage'),
  ('role-supervisor','perm-split-bill'), ('role-supervisor','perm-gift-override'),

  ('role-manager','perm-order-create'), ('role-manager','perm-order-void'),
  ('role-manager','perm-order-discount'), ('role-manager','perm-order-transfer'),
  ('role-manager','perm-order-closeother'), ('role-manager','perm-order-price'),
  ('role-manager','perm-payment-take'), ('role-manager','perm-payment-refund'),
  ('role-manager','perm-payment-recon'), ('role-manager','perm-shift-manage'),
  ('role-manager','perm-kds-operate'), ('role-manager','perm-catalog-manage'),
  ('role-manager','perm-settings-manage'), ('role-manager','perm-audit-view'),
  ('role-manager','perm-reports-view'),
  ('role-manager','perm-business-day'), ('role-manager','perm-x-report'),
  ('role-manager','perm-z-report'), ('role-manager','perm-cash-manage'),
  ('role-manager','perm-gift-manage'), ('role-manager','perm-gift-override'),
  ('role-manager','perm-catalog-import'), ('role-manager','perm-backup-manage'),
  ('role-manager','perm-table-layout'), ('role-manager','perm-split-bill'),
  ('role-manager','perm-discount-rules'),

  ('role-administrator','perm-order-create'), ('role-administrator','perm-order-void'),
  ('role-administrator','perm-order-discount'), ('role-administrator','perm-order-transfer'),
  ('role-administrator','perm-order-closeother'), ('role-administrator','perm-order-price'),
  ('role-administrator','perm-payment-take'), ('role-administrator','perm-payment-refund'),
  ('role-administrator','perm-payment-recon'), ('role-administrator','perm-shift-manage'),
  ('role-administrator','perm-kds-operate'), ('role-administrator','perm-catalog-manage'),
  ('role-administrator','perm-settings-manage'), ('role-administrator','perm-audit-view'),
  ('role-administrator','perm-reports-view'),
  ('role-administrator','perm-business-day'), ('role-administrator','perm-x-report'),
  ('role-administrator','perm-z-report'), ('role-administrator','perm-cash-manage'),
  ('role-administrator','perm-gift-manage'), ('role-administrator','perm-gift-override'),
  ('role-administrator','perm-catalog-import'), ('role-administrator','perm-backup-manage'),
  ('role-administrator','perm-license-manage'), ('role-administrator','perm-table-layout'),
  ('role-administrator','perm-split-bill'), ('role-administrator','perm-discount-rules'),
  ('role-administrator','perm-users-manage'),
  ('role-manager','perm-users-manage');

-- Floor plan left empty on purpose (no default halls/tables after setup).

