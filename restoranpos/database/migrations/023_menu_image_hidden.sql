-- Let a restaurant turn a dish's photo off without losing it.
--
-- The order screen resolves a picture from the bundled artwork by product id,
-- so clearing `image` does not hide anything - it just falls back to the stock
-- shot. Hiding has to be stated, not implied by an empty field, and it has to
-- survive the photo being set again later.
--
-- A hidden product renders as a text card instead, which is what a venue whose
-- own dishes look nothing like the stock photography actually wants.
ALTER TABLE menu_items
  ADD COLUMN image_hidden INTEGER NOT NULL DEFAULT 0 CHECK (image_hidden IN (0,1));
