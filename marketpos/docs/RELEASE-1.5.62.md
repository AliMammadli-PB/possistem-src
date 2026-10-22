# Market POS 1.5.62

Based on GitHub `market-1.5.61` commit `7d1bfcf62175e1504652b0a7f1887689ad0c5d78`, preserving its scale barcode settings, label-format selection, and sales-margin fields, together with the existing local branch/login, receipt, and weighted-stock fixes.

- Parametrlər → Tərəzi: configurable weight/price barcode reading rules, 20–29 prefixes, label detection and dry-run preview, LAN PLU format selection. A PRICE barcode must yield an exact whole-gram total; otherwise it is explicitly refused rather than silently changing the amount. Finer money precision rounds to qəpik consistently. Zero-weight labels cannot become one-piece sales. Price-only labels derive weight from the current price; weight barcodes remain preferable for exact stock tracking.
- Destructive operations accept an active manager's private 4–8 digit PIN or the signed 10-digit superadmin code. Staff-facing wording is “Müdir”. Roles and action permissions remain enforced; central permission editing still requires the signed administrator. Verification is throttled and successful approvals are audited before the operation. Failed/cancelled confirmation performs no write.
- Stock purchase/sale values are explicitly labelled as **Qalıq alış dəyəri / Qalıq satış dəyəri**. Negative and fractional quantities round consistently; warehouse splits are combined before total valuation. Potential stock margin and sales margin are separate. Sales margin uses **current cost**, explicitly stated in the UI; it is not a historical-cost net-profit accounting report.
- Excel monetary cells remain numeric and display two decimal places plus ₼. Quantity precision and leading-zero barcodes are preserved.
- Existing sales, debts, returns and migrations are retained. No new database migration is required for 1.5.62.

## TM-30F limitations

The actual paper is **45 × 25 mm**. The format number selects a template already on the scale; it does not upload a newly drawn template. Only validated PLU commands are transmitted. Undocumented commands for firmware decimal settings or label-template upload are not sent. Device-specific Spec instructions from 1.5.61 were replaced with the manufacturer TM-F denomination guidance and an explicit firmware check. Price stays in integer qəpik on the wire (800 = 8.00 AZN); dividing it by 100 would corrupt prices.

**No physical TM-30F/printer was available.** Network framing and acknowledgements were tested with a loopback device; a physical 45 × 25 mm print and the scale's own decimal/template configuration still need checking. No claim is made that a graphical template was uploaded to the scale.

## Validation

- TypeScript and production build; Windows Setup + Portable packaging, dependency closure checks.
- Native scale barcode tests on Linux and Windows, including price-derived weight, decimals, zero labels, mismatched prices and role refusal.
- Real Windows Market + warehouse cores: exact 310 g and 5 g sales/returns, duplicate synchronization, preserved old receipt schema migration.
- Manager verification, inactive/cashier/wrong-code rejection, policy isolation, throttling, audit failures, forged payload stripping.
- Financial integration tests: customer credit, scoped receipts, edit/cancel, rollback and idempotency; sales-margin discounts and returns.
- Real preload/returns/navigation browser checks; new scale screen in AZ/RU/EN at 360/768/1024/1366 px.
- Shipped warehouse valuation and Excel structure tests.

Windows artifacts use the existing unsigned publishing workflow. Physical printer/scale testing and interactive Windows Setup installation were not performed.
