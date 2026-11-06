# Restaurant management UI

`components.jsx` owns the shared management rail, searchable module entries,
settings picker and contextual operations navigation. `style.css` owns their
appearance. Purchases and sales share the **Ticarət** entry; their existing routes,
permissions, records and business components remain separate internally.

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
`delivery-sidebar-prompt.json` records its built-in generation and refinement.
The old delivery creation pill is removed from the floor; **+ Yeni sifariş**
opens the same form inside Delivery, preserving its native creation workflow.

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
