# Restaurant management UI

`components.jsx` owns the shared management rail, searchable module entries,
settings picker and contextual operations navigation. `style.css` owns their
appearance. Purchases and sales share the **Ticarət** entry; their existing routes,
permissions, records and business components remain separate internally.

Settings use a visible 208 px section list instead of the former dropdown.
At 900 px and below the list becomes a two-column button grid above the form.
Only this local settings rail is shown; “İdarəetmə” returns to the management
groups. Native buttons retain keyboard navigation and current-page state, while
the existing section routes and save handlers stay unchanged.

Operations now use a 168 px left section list with 28 px PNGs instead of the
top selector. At 900 px and below, **Bölmələr** opens a keyboard-accessible drawer.
Delivery lives in the main sidebar. Unpermitted destinations and empty groups
are omitted from navigation and search. QR inbox polling stays mounted while its
button only appears for pending/accepting orders; requests from a previous
session cannot repopulate the inbox after an account or permission change.

`scripts/apply-restaurant-management.mjs` runs last in the desktop assembly. It
preserves the existing settings forms and operations, replaces their navigation,
and compiles these readable components into the recovered renderer. Its output
is byte-for-byte stable when the patch runs twice. The older admin/settings
patches recognize the new owner; the object patch targets the shared link hook.

There are 28 transparent PNG illustrations in `assets/modules/`. They were
generated with the built-in `image_gen` tool, then trimmed and resized to 192 px
with alpha preserved. `image-prompts.json` records the exact prompts and original
output paths. Assembly includes the assets in desktop and remote branch builds.

The main sidebar uses the separate, predominantly white
`assets/modules/delivery-sidebar-white.png` variant for contrast on blue.
The selected light navigation surface switches to the existing blue
`assets/modules/delivery.png`; it never displays the white variant on white.
`delivery-sidebar-prompt.json` records its built-in generation and refinement.
The old delivery creation pill is removed. The floor delivery area has a compact
**+** action; **+ Yeni sifariş** remains inside Delivery. Both open the same form
and native creation workflow, with immediate duplicate-submit locking.

Verification on 2026-11-06:

- Desktop assembly: 130/130 patches, desktop and remote branch outputs built.
- `node scripts/qa-management.mjs`: real shipped React components with isolated
  IPC fixtures; all navigation groups, PNG loading, section search, direct printer
  links, hidden destinations/groups, saved printer routing and legacy sales/purchase
  routes; actual AppShell, negative-stock warning, drawer selection/Escape,
  QR 0→1→2→0, accept/reject, network failure, stale account responses and revoked
  permissions. Chromium 151.0.7922.34, 1536×816, 1366×735, 768×1024 and 390×844.
- No-native-dialog, restaurant-cloud-ipc and refund-by-code suites: 12 tests pass.
- QR runtime: 4 tests pass (approval, ambiguous timeout, rollback and acknowledgement recovery).
- Original `Ops*` business function definitions match the user's 1.10.9 source.

Before/after screenshots and the layout results are in
`artifacts/management-refresh/`. The fixtures use no customer database or physical
printer. This work prepares the local NEWEST build; it does not publish a release.

## Settings destinations and updater

The Settings group shows Restaurant (instead of another Settings card), System and Updates directly. `/settings?section=updates` owns the compact updater view; `/settings?section=system` keeps logs and the POS service controls. The installed application's existing check/status/install IPC and version remain unchanged. Update notices deep-link to the update view. A thrown IPC check displays an error and restores the action; development-mode status is shown explicitly. The existing permissions hide these links for unauthorized users. The restaurant update view is excluded from Market's embedded printer/settings surface.

`assets/modules/updates.png` is a transparent PNG generated with built-in image_gen; its prompt and source are in `update-icon-prompt.json`. `scripts/qa-management.mjs` covers check, pending, failure, download progress, install readiness, banner routing and 16 viewport/screen combinations, using isolated updater responses.

Cash accounts use `management/cash.jsx`. All management links open `/operations?tab=kassa`; `/admin/cash` redirects there for existing bookmarks. The account card opens an unsubmitted transfer form; its overflow contains movement history, edit and archive. Transfer-all uses the account's integer-qəpik available balance, never receipts. Native insufficient-balance and permission checks remain authoritative. UI submissions are locked immediately and retain the same idempotency key on retry.

`cashAccounts.moves` accepts opt-in `includeSales:true`. Its read-only ledger projects approved cash/card tender allocations and completed refunds alongside existing account moves; it does not post sale amounts again. Period opening/in/out/closing aggregates are calculated before list filtering and the 5,000-row limit; capped lists explicitly ask for a shorter range. The default response for older callers remains unchanged. Lifetime receipts start at account creation. Old remote cores show a compatibility message instead of claiming to provide full sale history.

Cash acceptance: `node scripts/qa-cash-workspace.mjs` uses the real renderer with isolated IPC data. Covers canonical and legacy entry paths, card/overflow actions, transfer-all, overdraft, repeated clicks, retry identity, unified history, permission changes and four viewport sizes. `node --test scripts/test-cash-build.mjs` checks retained Market register identity and shift/X–Z access in shared builds. `[activity]` native tests reconcile mixed tender/tips, refunds, transfer, expense, historical period totals, branch isolation and replay without double movement. No customer database is used.

## Delivery and white floor preview

`management/delivery.jsx` owns the delivery tables: fixed column budgets on desktop, labelled stacked rows below 1050px, and wrapping for long customer-entered text. The settlement dialog scrolls its invoice list independently so the account selector and collection action remain visible. Dining-room payment/transfer actions are excluded from delivery floor actions and the delivery order header; courier dispatch and collection remain available. These are presentation changes, not new payment postings.

The `.pm-floor` view uses a white canvas with the sidebar’s blue brand-pattern header, blue free tables and distinct amber/green occupied/printed states. Area buttons expose `aria-pressed`; the outer sidebar retains the blue brand pattern. The layout is scoped to the restaurant floor, leaving other workspaces unchanged.

Run `node scripts/apply-restaurant-management.mjs` to refresh the source renderer for a preview, then `node scripts/qa-delivery-floor.mjs`. This exercises the actual renderer with synthetic long text, four viewport sizes, settlement visibility, collection payloads, normal dining-room payment, and delivery action exclusions. Screenshots: `artifacts/delivery-floor/`. No POS build or installer publication was performed for this preview.

The floor header and sidebar use the same viewport-anchored 510px brand tile. The redundant object banner is removed only on Tables; order pages keep their context. Floor-only sidebar borders/shadows are transparent, so opening the rail does not restart or shift the pattern. `qa-delivery-floor.mjs` also captures the expanded rail at the four target sizes.

The floor title is a compact Masalar heading without the redundant table count. White transparent PNGs label Boş, Aktiv and Çek. Selecting the delivery area changes the heading to Çatdırılma and shows + only with delivery.manage permission. On pointer/keyboard expansion at 768px and wider, the sidebar reserves its full width so the title and table area move together. Narrow layouts retain the overlay rail. The floor QA checks heading visibility and first-card alignment.

The first sidebar entry aligns with the white floor work area. The heading measures the real layout (including fonts, navigation padding and scroll) and updates a scoped navigation gap when the header/rail changes size. ResizeObserver is optional; window resize and rail transition events provide fallback updates. Measurements do not trigger React renders, and cleanup restores the previous navigation gap.

## Floor icons and delivery creation — 2026-11-06

Four built-in image_gen assets are optimized to alpha PNGs in `assets/modules/`: delivery-outline-v2, table-status-free-v1, table-status-active-v1 and table-status-receipt-v1. Originals and size/alpha manifest: `artifacts/floor-icons/`. The scooter is white on blue and CSS-tinted dark blue when selected.

`qa-delivery-floor.mjs` verifies four viewport sizes, PNG loading, absent object/count banner, delivery-only +, live permission revocation, address validation, a double click producing one native create call, navigation to the created order, plus existing collection/dining-room guards. `qa-management.mjs` covers selected/off icon contrast and the existing navigation/settings/QR flows. Chromium 151.0.7922.34; synthetic local IPC data only.

## Adaptive sale-page capacity — 2026-11-06

`usePsSaleGrid` measures the real product area (after category rail, cart and paging controls), selecting as many 140×100 CSS px cards as fit with 8 px gaps. There is no fixed 12-product page limit. Capacity grows with the available width/height and adjusts on resize; the previously visible page anchor stays reachable. Only one page renders, so a large catalogue does not create an unlimited DOM. ResizeObserver has a window-resize fallback, font readiness triggers remeasurement, and root font enlargement increases the minimum card size.

The mobile sale header wraps its actions instead of clipping Payment. Categories become a single scrolling row below 601 px, preserving the compact left rail above that breakpoint. The product section and cart remain separately reachable on short/mobile screens. Names retain their full accessible text/title; prices stay untruncated. Product IDs, modifiers, size choice, stock, recipes and checkout handlers are unchanged.

`node scripts/qa-sale-grid.mjs` uses actual shipped React components with isolated IPC: 137 products across all pages, 12 viewport sizes (360–2560 px plus short landscape), long names, large prices, disabled stock, keyboard focus, adding an item, nested categories and exact 30 cm product selection, empty categories, page-anchor preservation on resize, and absent ResizeObserver. Chromium 151.0.7922.34. Screenshots and measured capacities: `artifacts/sale-grid/`. With the synthetic category rail and open cart: 1536×816 = 6×5 (30 cards), 1920×1080 = 9×8 (72); actual category label width and window size affect these counts. The existing native/shared-category QA now locates its last product independently of page capacity.

## Restaurant operational audit — 2026-11-06

`scripts/qa-restaurant-day.mjs` now drives an isolated real native core and the shipped sale/payment screens through the preload: recipes and size selection, stock consumption, cash/mixed payment, refund, cash/bank reconciliation, X/Z, kitchen/day blockers, shifts, role denials, retry identity and core restart. `artifacts/restaurant-audit-20261106/REPORT.md` records actual evidence and unresolved device/configuration limits. Management assembly hides the sale payment action without payment.take and gives PaymentPage a recoverable load-error state. Existing explicit role grants remain unchanged.
