CREATE TABLE sale_corrections (
 id TEXT PRIMARY KEY, request_json TEXT NOT NULL, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
 replacement_id TEXT REFERENCES sales(id), reason TEXT NOT NULL, actor_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
