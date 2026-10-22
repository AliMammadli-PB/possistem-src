-- Enable the newly connected receipt drawer flow once on upgrade.
-- Later explicit setting changes survive subsequent startups.
INSERT INTO app_settings(key,value,value_type,updated_at)
VALUES ('printer.openCashDrawer','1','string',0)
ON CONFLICT(key) DO UPDATE SET value='1';
