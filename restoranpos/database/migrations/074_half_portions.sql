-- 1.10.32. Half portions. A modifier can stand for a share of the dish (500 = half):
-- the line is priced with its own delta and stock gives up that share of the recipe.
-- A product's half portion lives in its own group 'portion:<productId>' with the option 'portion:<productId>:half'.
ALTER TABLE modifiers ADD COLUMN portion_milli INTEGER NOT NULL DEFAULT 1000 CHECK (portion_milli BETWEEN 1 AND 10000);

-- The half portion keeps the price the owner gave it when the full price changes.
CREATE TRIGGER menu_item_half_price AFTER UPDATE OF price_minor ON menu_items
WHEN NEW.price_minor <> OLD.price_minor BEGIN
 UPDATE modifiers SET price_delta_minor = price_delta_minor - (NEW.price_minor - OLD.price_minor)
 WHERE id = 'portion:' || NEW.id || ':half';
END;
