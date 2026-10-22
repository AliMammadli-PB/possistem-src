-- Platform support is a login/audit identity, never a merchant payroll card.
-- Existing employees and their ledgers are unchanged.
DROP TRIGGER staff_partner_insert;
CREATE TRIGGER staff_partner_insert AFTER INSERT ON users
WHEN NEW.id <> 'possistem-admin' BEGIN
 INSERT INTO customers(id,name,kind,user_id,active,created_at,updated_at)
 VALUES('staff-'||NEW.id,NEW.full_name,'employee',NEW.id,NEW.active,NEW.created_at,NEW.updated_at);
END;
DROP TRIGGER staff_partner_update;
CREATE TRIGGER staff_partner_update AFTER UPDATE OF full_name,active ON users
WHEN NEW.id <> 'possistem-admin' BEGIN
 UPDATE customers SET name=NEW.full_name,active=NEW.active,updated_at=NEW.updated_at WHERE user_id=NEW.id;
END;
