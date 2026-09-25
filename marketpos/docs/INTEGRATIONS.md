# MarketPos hardware & fiscal integrations

## Status

MarketPos ships **provider interfaces** and **mock/sandbox adapters**.

Real Azerbaijan e-kassa operator APIs and bank acquiring SDKs are **not** hard-coded because official credentials and protocol docs are customer-specific.

## Printer / cash drawer

- Module: `electron/hardware/printer.js`
- Default: `MockPrinterProvider` / `FilePrinterProvider` (writes ESC/POS bytes for verification)
- Supports 58mm / 80mm receipt layout, test page, cut, drawer pulse (`ESC p`)
- Wire a concrete USB/serial ESC/POS adapter by implementing `printRaw(Buffer)`

## Fiscal (e-kassa)

- Module: `electron/hardware/fiscal.js` → `MockFiscalProvider`
- Core tables: `fiscal_queue`, sale `fiscal_status`
- RPCs: `fiscal.enqueue`, `fiscal.listPending`, `fiscal.updateStatus`, `fiscal.retry`
- Idempotency keys prevent duplicate fiscal submissions

### Required from a real operator (before production)

1. Operator name / NBA-registered model list
2. Authentication (API key, mTLS, or device certificate)
3. Sale / refund / shift-close request schemas
4. Sandbox base URL (do not invent)
5. QR / fiscal ID field mapping for the receipt footer

## Bank POS terminal

- Module: `electron/hardware/terminal.js`
- Modes in settings: `manual` | `mock_integrated`
- `ManualTerminalProvider`: cashier records terminal reference
- `MockTerminalProvider`: simulates approve/decline for QA

### Required from an acquirer

1. Integration type (COM/USB SDK, TCP, or cloud)
2. Auth / merchant IDs
3. Currency / amount format (qəpik vs manat)
4. Refund and cancel flows
5. Offline / timeout policy

## Scale

- Core parses configurable EAN-13 scale rules from settings `scaleBarcodeRules`
- Live serial/USB scale: `electron/hardware/scale.js` stub (`ScaleProviderStub`); barcode path is production-ready

## Platform stubs (Phase 6)

- RPCs: `platform.syncStatus`, `platform.priceScopes`, `platform.eqaimeStatus`, `platform.aggregatorStatus`
- Tables ready: `sync_meta`, `price_scopes`
- Real multi-branch sync / e-qaimə / delivery aggregators require operator contracts (do not invent endpoints)

## Packaging

```bash
npm run market:package:win
```

Produces `MarketPos-Setup.exe` via `scripts/package-market-win.mjs`.
