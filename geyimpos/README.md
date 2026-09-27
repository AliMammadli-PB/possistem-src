# Geyim POS

possistem's till for clothing, shoe and accessory stores (AZ/RU/EN). It works
offline, with an email account per shop and a PIN per person, like Restoran
POS and Market POS.

It is a fork of `../marketpos` and shares its layout: Electron main
(`electron/`), React/Vite renderer (`src/`), and a C++20 core (`native/`)
speaking NDJSON. The IPC channel names (`market:*`) and the control-plane
routes (`/market-pos/*`) are shared on purpose; the licence product is `geyim`.

## What is clothing-specific

- **No ready-made products.** A shop creates its own models under *Məhsullar*.
  A product shows on the sale screen as soon as it has stock.
- **Models and variants.** A new model is entered once. The size × colour grid
  then creates one product per variant, with its own SKU, EAN-13 (in-store 20
  prefix) and opening stock. Ready lists live in `src/apparel.ts`: departments,
  34 categories, 8 size scales, 25 colours, materials and seasons. Migration
  `011_apparel.sql` adds brand, material, season and gender.
- **Barcodes.**
  - A scanner (keyboard burst), or typing on the search box or on the 0-9 pad
    of the sale screen, for tags the laser cannot read.
  - The core resolves the code as scanned first, so alphanumeric CODE128 tags
    work.
- **Labels.** *Etiket çap et* prints CODE128 price tags on an A4 sheet
  (`src/code128.ts`, no library) or on a thermal label printer.
- **Exchanges.**
  - Return chosen lines of a receipt (`return.partial`).
  - *Dəyişmə* returns the chosen lines, then carries the refunded amount to the
    sale screen as credit.
- **Touch and mouse.** `(pointer: coarse)` enlarges the targets. The payment
  and barcode pads work with either.
- **Look.** It keeps the possistem blue. Its own things are:
  - the hanger icon (`design/app-icon.svg`, rendered by sharp); the login
    background is the same photo as the other tills;
  - apparel icons (`src/ApparelIcon.tsx`);
  - the sidebar order;
  - the sale layout: barcode pad left, category chips on top.

## Run and verify (from `../restoranpos`)

- Development: `npm run geyim:dev`
- Type check: `npm run geyim:typecheck`
- Core: `npm run geyim:build:core`, then run
  `TZ=TRT-3 wine native/build/market_core_tests.exe` here.
- Unit tests: `npx vitest run tests/unit/geyim-apparel.test.ts`
- End to end in Electron, with a Linux core in `native/build-linux`:
  `node scripts/smoke-geyim-electron.mjs <screenshot-dir>`
- Windows Setup + Portable: `npm run geyim:package:win -- --allow-unsigned`

The market:* build scripts serve both tills: `POS_APP=geyimpos` selects this
one (`scripts/pos-app.mjs`).
