# Aptek POS

possistem's till for pharmacies (AZ/RU/EN). It works offline, with an email
account per pharmacy and a PIN per person: the sign-in and PIN screens are the
same as Restoran, Market and Geyim POS. What comes after the PIN is its own.

It is a fork of `../geyimpos`, which is itself a fork of `../marketpos`.
- **Layout:** Electron main (`electron/`), React/Vite renderer (`src/`), and a
  C++20 core (`native/`) speaking NDJSON.
- **Shared on purpose:** the IPC names (`market:*`) and the control-plane routes
  (`/market-pos/*`).
- **Licence:** the product is `aptek`, a market-family licence with
  `features.vertical = 'aptek'`. Every sale creates its own customer account,
  so each pharmacy's data is separate.

## What is pharmacy-specific

- **Medicines.** Each medicine records:
  - name, active ingredient (INN), strength and dosage form (13 forms);
  - shelf group (26), manufacturer, country, registration no. and storage
    (room, 2-8 °C, frozen, dark).

  Migration `011_pharmacy.sql` adds these columns. The lists are in
  `src/pharmacy.ts`.
- **Prescription medicines.** A medicine can be prescription-only.
  - If the cart holds one, the till asks for the prescription (number, date,
    doctor, clinic, patient) before payment.
  - The prescription is stored on the sale.
  - **Hesabatlar → Resept jurnalı** lists these sales.
- **Packs and units.** A pack may be opened and sold by the unit.
  - Stock and price are then kept per unit. The list offers "+ Qutu" and
    "+ tablet".
  - The cart shows "1 qutu + 5 tablet".
- **Lots and expiry.**
  - Stock only arrives as a lot: lot number, expiry and quantity. This is done
    in the medicine form, or with **Seriya qəbul et**.
  - The core sells the lot that expires first (FEFO).
  - It refuses stock that sits in expired lots (`E_EXPIRED_STOCK`).
  - An "expired" write-off empties the expired lots.
  - Receiving a lot needs the `RECEIVE_PURCHASE` right.
  - **Hesabatlar → Son istifadə tarixi** lists the expired lots and those
    expiring within 90 days.
- **GS1 DataMatrix.** A scan of `(01)GTIN(17)expiry(10)lot(21)serial`, with
  FNC1 or in brackets, finds the medicine by its GTIN/EAN-13. A box past its
  expiry is stopped at the scanner. The lot form fills its lot and date from
  the scan.
- **Sale screen.** The sale screen is a list rather than tiles, searched by
  name, INN, manufacturer or barcode. It has quick filters (OTC, Rx, fridge,
  expiring within 90 days) and the 0-9 pad for barcodes the scanner cannot
  read. Each row shows the medicine's shelf, and typing a shelf code (e.g.
  `A-1`) lists that shelf.
- **Shelves.** Migration `012_shelves.sql` adds a `shelves` table and
  `products.shelf`; the core has `shelf.list/save/delete`, and a shelf that
  still holds medicines cannot be deleted. The Dərmanlar page has a
  Dərmanlar | Rəflər switch that shows which medicine sits on which shelf,
  plus the ones with no shelf yet. Price tags print the shelf.
- **In-store barcodes.** Goods with no maker's barcode get an EAN-13 in the
  shop's own 20… range ("Barkod yarat"), printed on the CODE128 price tag.
- **Look.** It keeps the possistem blue. It differs from the other tills by
  its cross-and-capsule icon, its dosage-form icons, the list layout and its
  sidebar order: Satış, Dərmanlar, Alışlar, Hesabatlar, …

## Run and verify (from `../restoranpos`)

- Development: `npm run aptek:dev`
- Type check: `npm run aptek:typecheck`
- Core:
  1. `npm run aptek:build:core`
  2. then, here: `TZ=TRT-3 wine native/build/market_core_tests.exe` (`[pharmacy]` tests)
- Unit tests: `npx vitest run tests/unit/aptek-pharmacy.test.ts`
- End to end in Electron (Linux core in `native/build-linux`):
  `node scripts/smoke-aptek-electron.mjs <screenshot-dir>`
- Windows installer: `npm run aptek:package:win -- --allow-unsigned`, then
  `node scripts/publish-release.mjs aptek`
