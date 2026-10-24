-- WhatsApp now addresses 1:1 chats by @lid and withholds the phone number, so
-- the bot has to keep its own lid → phone map to recognise the owner. Holding
-- it only in memory meant every API restart turned the owner into a stranger
-- again, so it is persisted alongside the numbers it maps.

ALTER TABLE owner_whatsapp_settings
  ADD COLUMN IF NOT EXISTS lid_map JSONB NOT NULL DEFAULT '{}'::jsonb;
