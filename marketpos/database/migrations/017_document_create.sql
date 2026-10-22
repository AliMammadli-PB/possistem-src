INSERT OR IGNORE INTO permission_catalogue(permission,grp,label) VALUES('DOCS_CREATE','anbar','Qaimə yaratmaq');
INSERT OR IGNORE INTO role_permissions(role,permission) VALUES('manager','DOCS_CREATE'),('warehouse','DOCS_CREATE');
