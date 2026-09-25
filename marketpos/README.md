# MarketPos

A separate offline-first retail checkout in `market-pos/`, designed for grocery and convenience-store workflows rather than restaurant tables.

## Included

- Touch-first checkout, exact barcode scanning/search, cart quantities, cash/card completion, and held sales
- Stock levels and minimum-stock alerts, purchase orders and receiving, receipt lookup, refunds with restocking
- Daily KPIs, margin estimate, average basket, hourly chart, and top-product report
- Local persistence, offline mutation queue, reconnection indicator, and installable PWA shell
- Complete Azerbaijani, Russian, and English navigation, products, categories, units, dates, and currency formatting
- 58-product reference catalog with editable local prices, real branded product imagery, bread/weighted-item cashier shortcuts, and scan-to-fill product creation

## Run and verify

- Development: `npm run market:dev`
- Type check: `npm run market:typecheck`
- Production build: `npm run market:build`
- Windows Setup + Portable: `npm run market:package:win -- --allow-unsigned`

The production web assets are emitted to `market-pos/dist/`. This folder is intentionally separate from the Electron restaurant till so retail features can evolve without adding table/KDS complexity to restaurant customers.

Omit `--allow-unsigned` on a release machine and provide `CSC_LINK` plus
`CSC_KEY_PASSWORD` to produce signed Windows binaries.

## Catalog reference

The initial 58 product names, price snapshots, and catalog pictures were collected on 2026-08-24 from the public Bravo Supermarket catalog on Wolt at the user's request. Prices are seed/demo data and remain editable in MarketPos; they are not presented as a permanent live feed. Coca-Cola, Coolsy, Anchor, Sirab, Badamlı, Lays, and other names and packaging remain trademarks and visual assets of their respective owners.
