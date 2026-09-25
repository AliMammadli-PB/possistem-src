-- Allow a punch that clocks out in the same millisecond it clocked in.
--
-- The original CHECK demanded a strictly later time, so a member of staff who
-- clocked in and immediately realised their mistake got an error they could do
-- nothing about. SQLite cannot alter a CHECK, so the table is rebuilt - it is
-- new and empty everywhere, but the copy is there in case it is not.
CREATE TABLE IF NOT EXISTS attendance_rebuilt (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    schedule_id   TEXT REFERENCES staff_schedules(id),
    clock_in_at   INTEGER NOT NULL,
    clock_out_at  INTEGER,
    note          TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

INSERT OR IGNORE INTO attendance_rebuilt
    (id, user_id, schedule_id, clock_in_at, clock_out_at, note, created_at)
SELECT id, user_id, schedule_id, clock_in_at, clock_out_at, note, created_at FROM attendance;

DROP TABLE attendance;
ALTER TABLE attendance_rebuilt RENAME TO attendance;

CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id, clock_in_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_open
    ON attendance(user_id) WHERE clock_out_at IS NULL;
