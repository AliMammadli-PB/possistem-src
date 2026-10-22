ALTER TABLE suppliers ADD COLUMN company_name TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE market_customer_events ADD COLUMN ref_type TEXT NOT NULL DEFAULT '';
ALTER TABLE market_customer_events ADD COLUMN ref_id TEXT NOT NULL DEFAULT '';
CREATE TABLE market_document_actors (
 doc_type TEXT NOT NULL, doc_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 PRIMARY KEY(doc_type,doc_id)
);
