# Restaurant POS 1.9.25 — stock editing, size selection and restaurant workspaces

The warehouse owner can edit a selected restaurant stock card's name and selling price directly in the website. An explicit publication checkbox and the menu's “Anbardan əlavə et” picker turn a finished stock product into a dish without duplicating stock, losing its cost/unit/barcode or overwriting a recipe. Raw ingredients remain stock-only unless deliberately published. Existing linked drafts can be republished. Cloud editing requires Restaurant 1.9.25; older tills receive an update message. No schema migration or customer-data rewrite is introduced.

Existing pizza products named with size suffixes (for example “Marqarit pizza · 29 sm” and “· 31.5 sm”) are grouped for order display. The cashier chooses an actual size before the original product/modifier/order flow runs. Product identities, recipes, prices and stock remain independent. A lone size stays a normal named product.

Subscription polling, native PIN/batch checks and expiry enforcement remain active. Trial/paid-period information appears at PIN entry, with no floating subscription action or trial banner on tables, kitchen or order screens. Expired access returns to the login/payment screen.

## Design brief and audit

For cashiers operating a touch terminal, retain Possistem blue/white, fast scanning and visible cart totals. Use text navigation, one settings category column and stable work surfaces; keep permissions, routes, printer roles, payment state, order idempotency and real data intact. No new imagery, font service or animation dependency.

- Settings: competing pictorial/oversized navigation and repeated page chrome → shared text workspace navigation plus a persistent settings column; responsive horizontal categories on small screens. Fields/actions remain scrollable.
- Sale: four fixed tiny rows and image-backed category labels → larger text categories and product targets, 12 products per page, independent bounded product scroll, readable prices and size dialog.
- Inventory: branch overview was distant from stock work → “Bu filialın anbarı / Filialların qalıqları” inside Anbar, preserving manager visibility restrictions.
- Delivery: inconsistent small filters and oversized unequal metrics → shared control sizing, readable table typography and equal metric columns. Existing dispatch/settlement behavior retained.
- Payments: constrained mixed surfaces → wider two-column workbench and larger inputs/actions; no monetary, payment or SUNMI logic changes.
- Printers: selected-dish routing required navigating back to each menu card → dish search/checkboxes on the printer card. The till and preparation ticket can share a physical printer. Concurrent menu-routing edits are merged instead of silently discarded.

Matching before/after screenshots and logs are kept in the sibling task artifacts under `qa1925-before/`, `qa1925-after/` and `*1925*` logs. Chromium 151.0.7922.34 fixtures exercise real shipped components at 768/1366; catalogue/printer checks also cover 390; PIN/trial covers 360/390/768/1366/1920. No claim of accessibility certification, physical printer output, a Windows terminal installation or bank payment testing is made.

## Validation

- C++ native: 350 cases, 2638 assertions, including atomic stock edits, replay, rollback, publication, recipe/cost/quantity preservation, permission denial and existing printer routing.
- Access/PIN: 16 Node tests; isolated UI trial/expiry/payment checks pass.
- Restaurant and four other POS TypeScript checks; API and owner builds.
- Browser: real owner stock-edit dialog (fresh data, comma decimal, exact device, failed/successful save), API ownership/write/version gates, restaurant order size selection, catalogue scrolling and independent sizes, shared printer routing and reload persistence.
- Actual owner iframe boots through its browser bridge, saves arbitrary sizes and disables read-only mutations; no desktop billing IPC.
- Actual Electron 43.8.3 app boots against the native service and shows signed-out login. The local account was signed out during this check; trial access was tested with isolated fixtures rather than claimed as a live-account validation.
- Package transitive module closure, compiled/packaged core checksum equality and installer archive integrity. Installer lacks Windows Authenticode; the existing signed updater manifest is retained.

## Operator steps

1. Install Restaurant POS 1.9.25 on each affected till (the submitted branch was reporting 1.9.23). Use the official `/download/pos/` page; retain the existing data directory.
2. In website Anbar, choose the branch/card and “Ad / qiymət”. For a finished product absent from the menu, select “Restoran menyusunda göstər”, or use the menu's “Anbardan əlavə et”. Do not publish raw recipe ingredients.
3. Create/edit free-form pizza sizes as independent menu products. Opening their grouped order card asks for the saved size and uses its own recipe/price.
4. Under Parametrlər → Printer, edit Kassa, enable Mətbəx → Seçilmiş yeməklər and select Dönər. Save; check one real preparation ticket and one customer receipt on the physical till before service.

Previous 1.9.24 installers/feed and website/API/owner builds are retained for rollback. Market installer remains 1.5.78.
