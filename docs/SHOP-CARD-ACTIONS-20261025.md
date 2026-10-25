# Store navigation and direct card purchase actions

Public navigation and the catalog heading now read Mağaza / Store / Магазин. Existing catalog URLs, filters and the single catalog search remain unchanged.

Every ordinary product card displays a direct add-to-cart button beside its details link. Only products with a positive price and available stock can be added. Unpriced and out-of-stock cards retain the button disabled and explain why, including an accessible description. Private test products keep their separate test checkout.

Validation: Next.js production build and type checks passed. Chromium 151 browser checks at 390 and 1480 px confirmed the store title, one catalog search, no page overflow, direct addition without opening details, correct 150 AZN fixture cart total, and disabled actions for unpriced and out-of-stock fixtures. Fixtures replace only the browser's public catalog response; no production prices, inventory or payment transactions were changed.
