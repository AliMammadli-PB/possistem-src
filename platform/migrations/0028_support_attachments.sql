-- Files support staff send into a ticket, for the till to download and open.
--
-- The chat could only carry text, so helping a shop with a tool (a remote-access
-- installer, a printer driver, a corrected config) meant sending it out of band
-- and talking the cashier through finding it. Attachments ride the ticket the
-- conversation already lives in.
--
-- Bytes live on disk under SUPPORT_UPLOAD_DIR named by `id`; only metadata is
-- stored here, so a deleted file degrades to a missing download rather than a
-- broken row.
CREATE TABLE IF NOT EXISTS support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id uuid REFERENCES support_messages(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  -- Who put it there. Staff-only today; the column keeps the door open for the
  -- shop attaching a photo back without another migration.
  uploaded_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_attachments_ticket_idx
  ON support_attachments(ticket_id, created_at DESC);
