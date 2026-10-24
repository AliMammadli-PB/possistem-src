-- Owner WhatsApp alerts (QR-linked session settings)

CREATE TABLE IF NOT EXISTS owner_whatsapp_settings (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  recipient_phone TEXT NOT NULL DEFAULT '',
  admin_name TEXT NOT NULL DEFAULT 'Admin',
  message_template TEXT NOT NULL DEFAULT E'*{admin}*\n{title}\n{body}',
  wa_status TEXT NOT NULL DEFAULT 'disconnected',
  wa_user TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
