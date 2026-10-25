# Catalog layout — 25 October 2026

The catalog has one contextual search field. Desktop/mobile header search forms are omitted only on the catalog route; global search remains on other pages, including product details. Existing query, department, category and pagination URLs are preserved.

The design retains Possistem blue/navy/white and Montserrat. A compact page heading and search precede a desktop category rail; mobile uses labeled department/category selects. Product photos retain their aspect ratio. Product cards separate category, name, availability/price and actions, and no longer duplicate the unavailable message as a disabled button. Pricing, partner pricing, private-test visibility, stock limits and cart behavior remain unchanged.

Next production builds passed locally and on the host. Chromium 151.0.7922.34 checked 360/390/768/1480 px and light/dark surfaces, a single search input (also with the mobile menu open), search/clear, department filters, empty-result recovery, no page overflow and no uncaught errors. A browser response fixture with a positive price verified adding a product to the cart and its total; no real price or stock was changed. Actual remote product photos were separately checked loaded. Screenshots are outside Git in the workspace parent's artifacts/catalog-redesign-20261025/ directory.

The production Next build was exchanged atomically. The previous build remains /var/www/possistem/.catalog-redesign-20261025/.next for recovery. No API, POS executable or database change is part of this update.
