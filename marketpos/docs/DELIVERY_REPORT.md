# MarketPos P0–P6 delivery report

Date: 2026-09-12  
Package command: `npm run market:package:win` → `MarketPos-Setup.exe` via `scripts/package-market-win.mjs`

## Build / test results

| Check | Result |
|-------|--------|
| `npm run market:build:core` | OK (`market-pos-core` 1.3.0) |
| `market_core_tests` (from `native/build`) | **3/3 passed** (12227 assertions) |
| `npm run market:typecheck` | OK |
| `npm run market:build` | OK |

## Migrations

- `002_cashier_ops.sql` — permissions, cash_movements, z_reports, hold metadata, overrides, stock policy settings
- `003_retail_depth.sql` — fiscal_queue, terminal_transactions, refund_lines, stocktakes, customers/ledgers, loyalty, promos, lots, price_scopes, sync_meta
- Schema version: **v3** (codegen via `gen-market-migrations.mjs`)

## Protocol

- **94 methods** (was 44 → expanded through Phase 1–6)
- New platform stubs: `platform.syncStatus`, `platform.priceScopes`, `platform.eqaimeStatus`, `platform.aggregatorStatus`

## Phase summary

### Phase 1 — Cashier essentials — done
- **Found:** sale.complete, hold persist, open/close session, money as int64
- **Added:** listHeld/cancelHeld, cash in/out/safe drop, X/Z, permissions, manager PIN IPC, scanner module, hold resume via core, fake `+12.4%` removed from reports/mobile
- **UI:** RegistersOpsPage (X/Z + cash), ManagerApprovalModal, useBarcodeScanner

### Phase 2 — Hardware — done (mock/file)
- ESC/POS builder + File/Mock printer, drawer pulse, receipt DTO from `sale.receipt`
- Settings: test print, open drawer, width 58/80
- Scale barcode rules in core; `ScaleProviderStub` for future serial

### Phase 3 — Fiscal / terminal foundations — done (mocks)
- Fiscal queue + MockFiscalProvider + Electron drain worker
- Manual + Mock terminal; sale path records terminal ref
- Docs: `market-pos/docs/INTEGRATIONS.md`

### Phase 4 — Inventory depth — done (core + thin UI)
- Partial refund RPC, stocktake CRUD/post UI, CSV import preview/dry-run/commit, valuation/profit/lowStock reports

### Phase 5 — Commercial — done (core + customers UI)
- Customers + nisyə ledger RPCs, supplier/loyalty/promo/lot RPCs; Customers page for create/ledger

### Phase 6 — Platform stubs — done
- sync_meta / price_scopes tables + platform.* RPCs + Platform UI page

## Electron IPC added

- `market:printer:*`, `market:drawer:open`, `market:auth:verifyManagerPin`, `market:terminal:pay`, `market:fiscal:processPending`

## Still required for production e-kassa / bank

See `INTEGRATIONS.md`: operator credentials, sandbox URLs, schemas, QR mapping, acquirer SDK — **not invented**.

## Remaining P0 blockers (external)

1. Real fiscal operator contract  
2. Real bank terminal SDK/docs  
3. Physical ESC/POS device path (file provider used for QA)

## Non-goals respected

- Restaurant POS untouched  
- No floating-point money in core  
- No claim of real AZ e-kassa without vendor docs  
