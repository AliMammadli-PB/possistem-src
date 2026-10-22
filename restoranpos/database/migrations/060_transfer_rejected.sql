-- A recipient that definitively refused a dispatch (validation error, nothing
-- applied there) marks it, so the sender may recall the goods (1.5.46).
ALTER TABLE transfer_outbox ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0;
