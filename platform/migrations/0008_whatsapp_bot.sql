-- WhatsApp bot: who may command it, and which command families are live.
--
-- Catalog writes move money, so `bot_permissions` starts with catalog = false;
-- the owner turns it on from Parametrlər on the till.

ALTER TABLE owner_whatsapp_settings
  ADD COLUMN IF NOT EXISTS bot_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE owner_whatsapp_settings
  ADD COLUMN IF NOT EXISTS allowed_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE owner_whatsapp_settings
  ADD COLUMN IF NOT EXISTS bot_permissions JSONB NOT NULL
  DEFAULT '{"read":true,"reports":true,"catalog":false,"alerts":true}'::jsonb;
