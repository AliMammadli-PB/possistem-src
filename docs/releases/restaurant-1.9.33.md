# Restaurant POS 1.9.33

Feedback from a customer till on 1.9.32.

## Fixed

- **A size or dish looked as if it did not reach the cart.** The cart shows 4 lines a page and stayed on its page, so a line added past it was in the order but not on screen. Reproduced on 1.9.32: the order held the 30 sm line, the screen showed nothing. The cart now moves to the added line and flashes it, for every dish. The size dialog stays open until the add has worked and shows the error inside; a sold-out size says "Bitib".
- **Till card.** It shows only "Bu gün: nağd". The card amount stays on a till only when no bank covers it (a bank in that object, or a bank with no object), so card money is never out of sight.
- **Objects in the till form.** In Restoran the Obyektlər tab manages portal branches, while the form lists local objects, so a branch never reached it. Opening Kassalar now adds missing branches as local objects with their warehouse. A lone object is preselected in "+ Yeni kassa". Renaming a branch in the portal adds a new object and leaves the old one.
- **Refund by receipt code.** About 1 code in 32 starts with R itself ("R-RBC…"), and such a code was not found when typed without the prefix. Found because a test failed about 1 run in 20; it now passes every time.
- **Order screen photos.** A dish shows a picture only if the owner gave it one. Other screens keep theirs.

## New

- **Sub-categories, one level (İçkilər → Spirtli / Spirtsiz).** On the order screen a parent shows its sub-categories as tiles, then its own products; "← İçkilər" goes back. In Kateqoriyalar: a parent picker, "+ Alt kateqoriya", "İçinə köçür".
- **Moving products.** A category field in the dish editor and "Seçilənləri köçür →" in the list. Moving one size moves its other sizes, matched by name.
- **Set menus (business lunch).** "+ Menyu yarat" on the Kateqoriyalar page: name, price, category (default "Menyular"), products with quantities. Selling a menu takes the ingredients of its parts from stock. Each part prints on its own printer with the menu's name under it, and the kitchen screen lists the parts. The customer's receipt shows the menu and its price. The menu has no stock card of its own. Parts are fixed; the customer does not choose at sale time.
- **Goods reach the order screen.** "+ Yeni mal" has "Satışda göstər" (on by default) and a sale category (default "Mallar"), and then requires a sale price. Turn it off for raw materials. A good already on sale keeps its name and price in step. Excel import is unchanged.
- **Sizes in other units.** sm, qr, kq, ml, l in the size editor. The name carries the unit ("Pizza · 500 qr"). The limit stays 300 for sm and is 100000 for the others.
- **Staff.** "Düzəliş" on each person: name, role, new 4-digit PIN. "Kataloq" is now "Kateqoriyalar"; the warehouse tab is "Anbar kateqoriyaları".

## Rules tightened

- `users.setPin`: only an administrator can change an administrator's PIN.
- `users.update`: nobody is promoted to administrator from the till.
- A printer chosen for a parent category also takes its sub-categories.
- Up, down and drag move a category among its own level.

## Technical

- Migration `066_menu_subcategories_components.sql`: `menu_categories.parent_id`, `menu_item_components`, view `menu_item_recipe_expanded`. The table and view use `IF NOT EXISTS`, because tills from the diverged 1.9.25 already have them.
- `catalog.upsertProduct` takes `components: [{menuItemId, qtyMilli}]` and `sizeUnit`; it refuses a menu inside itself, directly or not. `catalog.publish` takes `categoryId`. `recipes.get` returns `components`. `catalog.products` returns `componentCount`.
- Stock on sale and on sale correction reads the expanded view.
- `apply-restaurant-1928.mjs` no longer adds a copy of the role label on every assemble.

## Checks

- Full native suite under Wine: 369 cases pass, with new cases for sub-categories, menu stock, tickets split by printer, units, the PIN rule, and migration 066 from schema 65 and from the diverged 1.9.25.
- `scripts/qa-1933.mjs`: real screens with a stateful mock at 1366 and 768 px (order screen), 1366 and 390 px (menu dialog). `scripts/qa-1933.mjs before` shows the cart problem on 1.9.32.
- `scripts/qa-core-1933.mjs`, real packaged core: a till on the diverged 1.9.25 (real SQL of 01066c2) and a till on 1.9.32 (280f90e) both start and reach schema 66 with a backup; wiping a till keeps its licence and a copy.

## Not tested

A physical till, a real printer ticket, the portal branch list with a real account, or the installer on real Windows.

## Not included

The owner portal is not rebuilt, so its embedded catalogue keeps a flat category list. Market and the other tills. A costed dish inside a recipe in the recipe editor. Adding sizes to an existing dish. Choices inside a menu at sale time.
