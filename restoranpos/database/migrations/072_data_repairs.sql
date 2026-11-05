-- 1.10.6. What the core put right by itself at start-up, for support to read. The repair lives in
-- services/DataRepair.cpp because it has to run again whenever the same state comes back; adding
-- this table also gives every till a pre-migration backup before its first repair.
CREATE TABLE data_repairs (
    id         TEXT PRIMARY KEY,
    detail     TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
