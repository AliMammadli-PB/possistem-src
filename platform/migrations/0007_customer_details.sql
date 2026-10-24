-- Satış formunda toplanan müşteri detayları (bayi paneli + super admin).
-- Hepsi nullable: mevcut müşteriler bu alanlar boş kalarak korunur.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS voen text,
  ADD COLUMN IF NOT EXISTS contact_person text;
