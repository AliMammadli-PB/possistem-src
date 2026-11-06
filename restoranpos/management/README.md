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
