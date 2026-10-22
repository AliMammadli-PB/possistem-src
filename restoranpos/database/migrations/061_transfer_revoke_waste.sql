-- 1.5.47. A dispatched transfer the sender takes back before the recipient
-- confirms it: the goods are already back on the sender's shelf, the recipient
-- has not answered yet (document() reports status 'revoke_pending').
ALTER TABLE transfer_docs ADD COLUMN revoking INTEGER NOT NULL DEFAULT 0;

-- Zay (waste) as a document: Z-00001, its lines, editable and cancellable. Stock
-- leaves through 'waste' movements referencing the document id.
CREATE TABLE IF NOT EXISTS waste_documents (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, warehouse_id TEXT NOT NULL,
 total_minor INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
 actor_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 cancelled_at INTEGER
);
CREATE TABLE IF NOT EXISTS waste_document_items (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES waste_documents(id),
 ingredient_id TEXT NOT NULL, qty_milli INTEGER NOT NULL CHECK(qty_milli>0),
 cost_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS waste_documents_order ON waste_documents(created_at DESC,id);
CREATE INDEX IF NOT EXISTS waste_items_document ON waste_document_items(document_id);
