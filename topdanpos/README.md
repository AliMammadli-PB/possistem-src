# Topdan POS

possistem's till for wholesale warehouses and distributors (AZ/RU/EN). It works
offline, with an email account per business and a PIN per person: the sign-in
and PIN screens are the same as Restoran, Market, Geyim and Aptek POS. What
comes after the PIN is its own: the sale is an invoice, not a basket.

It is a fork of `../aptekpos` (itself a fork of `../geyimpos` and `../marketpos`).
- **Layout:** Electron main (`electron/`), React/Vite renderer (`src/`), and a
  C++20 core (`native/`) speaking NDJSON.
- **Shared on purpose:** the IPC names (`market:*`) and the control-plane routes
  (`/market-pos/*`).
- **Licence:** the product is `topdan`, a market-family licence with
  `features.vertical = 'topdan'`. Every sale creates its own customer account,
  so each business's data is separate.

## What is wholesale-specific

- **Packs and pieces.** Stock is kept in pieces. A product ships in a pack
  (yeşik, qutu, blok, kisə, paket, rulon, palet) of N pieces. Quantities show as
  "12 yeşik + 3 şüşə". A product may be sold by the pack only, or by the piece too.
- **Three price levels.** Every product has a retail, a wholesale and a dealer
  price. They are typed per pack and stored per piece; the markup over cost is
  shown as you type. Migration `013_wholesale.sql` adds `price_wholesale_minor`,
  `price_dealer_minor` and `pack_name`. An update that omits them (a portal edit)
  keeps the stored values.
- **Customers set the price.** A customer has a price level, VÖEN, address, a
  credit (nisyə) permission and limit (`customers.price_tier`, `voen`, `address`,
  `note`). The core prices every sale line from the buyer's level
  (`sale.complete` reads `customers.price_tier`), so the till cannot undercut it.
- **Sale screen = invoice.**
  1. Pick the buyer (or sell at retail to a walk-in buyer). The screen shows
     their level, debt and remaining credit.
  2. Lines form a table with pack and piece steppers, found by scanner, the 0-9
     pad, type-ahead, or the price list (at the buyer's level).
  3. Payment splits over cash, card and nisyə. Nisyə is refused above the limit
     (`CREDIT_LIMIT_EXCEEDED`).
  4. The A4 qaimə-faktura lists seller and buyer with VÖEN, every line in packs
     and pieces, VAT, the total in words, and the debt before and after.
- **Customers and debts.** A list with price level, limit and debt. Actions:
  take a debt payment (cash, card or transfer), print the statement (üzləşmə
  aktı) from `customer_ledger`, filter debtors only.
- **Reports.** Debtors, and sales by buyer over the last 30 days (paid and nisyə),
  above the standard reports.
- **Goods.** Warehouse locations (rəf/sıra, from Aptek's shelves), in-store
  EAN-13 barcodes ("Barkod yarat", 20… range), CODE128 price tags per pack,
  opening stock on creation, and "Mal qəbulu" for later deliveries.
- **Look.** It keeps the possistem blue. It differs from the other tills by its
  pallet-and-cases icon, the invoice layout (buyer card, lines table, dark
  invoice header) and its sidebar order: Satış, Müştərilər, Mallar, Alışlar,
  Hesabatlar, …

## Run and verify (from `../restoranpos`)

- Development: `npm run topdan:dev`
- Type check: `npm run topdan:typecheck`
- Core:
  1. `npm run topdan:build:core`
  2. then, here: `TZ=TRT-3 wine native/build/market_core_tests.exe`. The
     `[wholesale]` tag covers price levels, pricing by buyer, and credit up to
     the limit and back.
- Unit tests: `npx vitest run tests/unit/topdan-wholesale.test.ts`
- End to end in Electron (Linux core in `native/build-linux`):
  `node scripts/smoke-topdan-electron.mjs <screenshot-dir>`
- Windows installer: `npm run topdan:package:win -- --allow-unsigned`, then
  `node scripts/publish-release.mjs topdan`
- Site demo: `node demo-web/build.mjs <out-dir>`, with the WebAssembly core in
  `native/build-wasm`. The seed has 20 goods, 11 locations, 5 buyers and two
  earlier credit invoices.
