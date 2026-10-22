-- 1.5.27: rights are set by POSSISTEM (the super admin, per customer role and
-- per worker); the shop only creates its users. Three document rights for
-- Əməliyyatlar's qaimələr, and SALE_CANCEL now means removing a scanned item
-- from the basket (storno) - without it the cashier needs a permitted PIN.
INSERT OR IGNORE INTO roles(role, label, custom) VALUES ('head_cashier', 'Baş kassir', 0);

UPDATE permission_catalogue SET label = 'Səbətdən malı silmək (storno)' WHERE permission = 'SALE_CANCEL';
INSERT OR IGNORE INTO permission_catalogue(permission, grp, label) VALUES
  ('DOCS_VIEW',   'anbar', 'Qaimələrə baxmaq'),
  ('DOCS_EDIT',   'anbar', 'Qaimələrdə düzəliş etmək'),
  ('DOCS_DELETE', 'anbar', 'Qaimələri silmək');

-- What each role could do before, so an update changes nothing by itself.
INSERT OR IGNORE INTO role_permissions(role, permission) VALUES
  ('manager', 'DOCS_VIEW'), ('manager', 'DOCS_EDIT'), ('manager', 'DOCS_DELETE'), ('manager', 'SALE_CANCEL'),
  ('warehouse', 'DOCS_VIEW'), ('warehouse', 'DOCS_EDIT'), ('warehouse', 'DOCS_DELETE'),
  ('head_cashier', 'DOCS_VIEW'), ('head_cashier', 'SALE_CANCEL'),
  ('cashier', 'DOCS_VIEW');
