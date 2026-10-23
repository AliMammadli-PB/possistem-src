# Caspos SUNMI integration contract

Source reference: supplied `Integration API SUNMI App v1.0.7.0 Doc v1.0.13.0 EN.pdf`, all 46 pages reviewed. PDF is not redistributed in this public source repository. This is the Caspos fiscal HTTP integration service, not Android raw printer API.

## Transport and contract

`protocol.cjs` implements all 21 operation names. POST JSON UTF-8 to a configured local IPv4 endpoint, default port5544. Credentials follow the document's top-level fields; access tokens are never exposed to the renderer. No redirect, public host or credential-in-URL forwarding. Protected OS credential storage is required.

| PDF pages | Operations | POS binding |
|---|---|---|
| 1–6 | setup, toLogin/toLogout/getInfo | connection test, identity pin |
| 7–10 | getShiftStatus/openShift/closeShift/deposit/withDraw | explicit fiscal shift and cash controls |
| 11–14 | sale and creditPayment | native immutable sale snapshots |
| 15–20 | credit/prepayment/prepaymentProducts | client contract; not automatically mapped to ambiguous legacy ledger allocations |
| 21–28 | moneyBack/correction/rollBack | item-linked sale return automatic; correction/rollback not exposed as unrestricted ledger bypass |
| 29–36 | X/periodic Z/control tape/copy/printer/drawer and fields | manager controls and real result display |
| 37 | tax/unit/code enum definitions | use enum table, not inconsistent examples |
| 38–46 | response codes | explicit refusals vs uncertain fiscal results |

Exact operation list is exported as `OPERATIONS` and validated. Numeric JSON tokens deliberately have two fractional digits for money and three for quantity, including integer-valued prices. All money stays integer qəpik until serialization; allocation uses BigInt largest remainders. Mixed payments must equal POS total. Code1 returns original fiscal document, not a new success without an ID. Code1205 is a review state. No invented get-by-UUID endpoint: the supplied control tape has no request UUID for reliable automatic matching.

Some document examples contain malformed commas/types or mismatched sample totals. Tests normalize JSON syntax, preserve documented enum values and never copy sample credentials. Card bank processing is not implemented by this fiscal adapter: supplied RRN must be approved externally and device-specific behavior accepted with Caspos.

## Durable pipeline

1. Native sale/refund and canonical fiscal snapshot commit in the same SQLite transaction.
2. `sunmi.pending` selects unacknowledged snapshots since opt-in activation; Restaurant also filters the current till.
3. Main process captures a tenant directory and serializes processing. Device identity is verified. Per-document atomic/fsynced journal freezes the UUID and payload before HTTP.
4. Device fiscal ID and matching total are stored before native success acknowledgment. Failure of local ACK cannot create another fiscal document.
5. Lost response retries the exact UUID/body. Deterministic rejection needs operator action; unknown item-name/total mismatch needs device review.
6. Per-parent indexes prevent over-refund even after documents leave the recent100 display. Files are hash-named, never derived raw paths.
7. Plaintext passwords are absent from journals/history. SafeStorage backend must be available. OS-owned identity/config is not a cloud-sync payload.

New migrations only: Restaurant062 (outbox + bank_rrn); Market022 (outbox). Existing customers, shifts, sale lines and migrations unchanged. Migration-generated headers are rebuilt with the existing scripts. Both native implementations capture actual immutable names, item units, totals and payment splits, not sample receipts.

## Renderer / IPC

Shared isolated settings component uses `possistem:sunmi`. Trusted sender + authenticated staff required; manager/owner/admin for config and device commands. Renderer cannot directly call internal native outbox/status methods or issue arbitrary fiscal sale payloads. Activation requires login/info/printer/shift probe and explicit tax selection. Source outbox is rescanned after restarts every15s while signed in.

The RRN dialog is injected inline into sandboxed preload. It collects12 digits, does not charge a bank card, and cancellation is explicit. External fiscal status notification is separate from local-sale success. Fiscal device shift and local cash-account shift are intentionally separate books, clearly labelled.

## Building

From the source repo's restoranpos directory with existing dependencies/toolchains:

```
node --test tests/sunmi-integration.test.cjs
npm run typecheck
node scripts/build-core.mjs --config Release
node scripts/build-market-core.mjs
node scripts/assemble-restaurant.mjs
node scripts/package-market-win.mjs --allow-unsigned
node node_modules/electron-builder/out/cli/cli.js --win nsis portable --x64 --config electron-builder.yml --publish never
```

`--allow-unsigned` is for a development/pilot artifact. Production release uses the project's signing policy. Do not run `publish-release.mjs` until the hardware acceptance and production signing/release requirements are fulfilled: it changes every customer's update feed. Source of shared driver is only `restoranpos/integrations/sunmi`; Market's electron/sunmi and renderer copies are staged build output. Restaurant assembler is idempotent and fail-closed on anchor mismatch.
