-- The initial local administrator is a login/audit identity, not a cashier's payroll card.
-- Keep IDs, roles, PINs, sales attribution and all financial history.
UPDATE customers SET partner_origin='system_login'
WHERE user_id='usr-admin' AND name IN ('Super Admin','Yerli administrator')
AND salary_minor=0 AND debt_minor=0
AND NOT EXISTS (SELECT 1 FROM salary_payments WHERE customer_id=customers.id)
AND NOT EXISTS (SELECT 1 FROM customer_ledger WHERE customer_id=customers.id)
AND NOT EXISTS (SELECT 1 FROM orders WHERE customer_id=customers.id);
UPDATE users SET full_name='Yerli administrator'
WHERE id='usr-admin' AND full_name='Super Admin' AND primary_role_id='role-administrator';
DROP TRIGGER staff_partner_insert;
CREATE TRIGGER staff_partner_insert AFTER INSERT ON users
WHEN NEW.id <> 'possistem-admin' BEGIN
 INSERT INTO customers(id,name,kind,user_id,active,partner_origin,created_at,updated_at)
 VALUES('staff-'||NEW.id,NEW.full_name,'employee',NEW.id,NEW.active,
 CASE WHEN NEW.id='usr-admin' AND NEW.full_name IN ('Super Admin','Yerli administrator') THEN 'system_login' ELSE 'partner' END,
 NEW.created_at,NEW.updated_at);
END;
DROP TRIGGER staff_partner_update;
CREATE TRIGGER staff_partner_update AFTER UPDATE OF full_name,active ON users
WHEN NEW.id <> 'possistem-admin' BEGIN
 UPDATE customers SET name=NEW.full_name,active=NEW.active,updated_at=NEW.updated_at,
 partner_origin=CASE WHEN partner_origin='system_login' AND NEW.full_name NOT IN ('Super Admin','Yerli administrator') THEN 'partner' ELSE partner_origin END
 WHERE user_id=NEW.id;
END;
