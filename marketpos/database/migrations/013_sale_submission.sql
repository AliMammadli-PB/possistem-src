-- A payment submission commits once, including stock and loyalty effects.
-- Its response survives a renderer restart or a lost IPC response.
CREATE TABLE IF NOT EXISTS sale_submissions (
  request_key TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id)
);
