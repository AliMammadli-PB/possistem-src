-- Aptek POS 1.1: shelves. Every medicine can name the shelf it sits on, so a
-- pharmacist finds a box without searching the room. Additive only.
CREATE TABLE IF NOT EXISTS shelves (
  code TEXT PRIMARY KEY,
  zone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE products ADD COLUMN shelf TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_shelf ON products(shelf);
