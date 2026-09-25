-- Lets the audit trail be archived off without making it editable.
--
-- `audit_logs_no_delete` blocked every DELETE unconditionally, which is the
-- right default and one unintended consequence: nothing could ever remove a
-- row, so `pos.db` grew for the life of the installation. A busy restaurant
-- writes thousands of entries a day and the file is on the till's own disk.
--
-- The trigger now stands aside only while `audit.pruneAllowed` is '1'. The
-- maintenance job sets that flag, writes the rows it is about to remove into a
-- gzipped archive under the data directory, deletes them, clears the flag, and
-- records the prune itself as an audit entry. Tampering still fails loudly:
-- flipping the flag is a visible, audited act, not a silent UPDATE.
--
-- UPDATE stays blocked outright. There is no legitimate reason to rewrite an
-- entry, and the sync watermark lives in app_settings precisely because of it.

DROP TRIGGER audit_logs_no_delete;

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
WHEN (SELECT value FROM app_settings WHERE key = 'audit.pruneAllowed') IS NOT '1'
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

-- Sync bookkeeping. Two settings rather than one because "what has control
-- already got" and "what has been archived" advance independently: a till that
-- is offline for a week must not archive events it has never forwarded.
INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at)
VALUES
    ('audit.pruneAllowed', '0', 'bool', 0),
    -- created_at of the last event control acknowledged, and the id that broke
    -- the tie at that timestamp. Two events can share a millisecond.
    ('audit.sync.watermarkAt', '0', 'int', 0),
    ('audit.sync.watermarkId', '', 'string', 0),
    ('audit.archive.lastRunAt', '0', 'int', 0);
