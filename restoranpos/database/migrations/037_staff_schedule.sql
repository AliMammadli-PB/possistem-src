-- Who is meant to be working, and who actually was.
--
-- Kept apart on purpose: the roster is a plan and attendance is a fact, and a
-- report that compares them is the point of having both.
CREATE TABLE IF NOT EXISTS staff_schedules (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at     INTEGER NOT NULL,
    ends_at       INTEGER NOT NULL,
    role_note     TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','confirmed','cancelled')),
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_schedule_user ON staff_schedules(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_schedule_when ON staff_schedules(starts_at);

CREATE TABLE IF NOT EXISTS attendance (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    schedule_id   TEXT REFERENCES staff_schedules(id),
    clock_in_at   INTEGER NOT NULL,
    clock_out_at  INTEGER,
    note          TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id, clock_in_at);
-- One open punch per person: clocking in twice is a mistake, not a second shift.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_open
    ON attendance(user_id) WHERE clock_out_at IS NULL;
