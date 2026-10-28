-- Permanent import keys survive crashes, cloud acknowledgement loss and bill closure.
CREATE TABLE qr_order_imports (
 external_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id),
 table_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
