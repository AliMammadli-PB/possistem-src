# Restaurant POS 1.9.34

## Fixed

- **Sub-categories did not open on the order screen.** The grid showed "no results" when a category had no products of its own, which hid its sub-category tiles. Moving the drinks into Spirtli and Spirtsiz is exactly what left İçkilər empty. An empty sub-category lost its way back the same way. Reproduced on 1.9.33 with the real core: 0 tiles.
- **A new dish was a draft by default.** "Menyuda yayımla" started off, so a new dish saved without ticking it never reached the order screen. It now starts on.

## Changed

- **Creating a sub-category.** "+ Alt kateqoriya" focuses the name field and says "İçkilər içində alt kateqoriya", with a cancel. After saving, the parent clears, so the next category is not made a child by accident.
- **Dish editor.** Two fields: "Kateqoriya" (top level only) and "Alt kateqoriya" (that category's children, shown only when it has some).
- **İnteqrasiyalar.** The SUNMI settings section is renamed and lists the systems in two groups. Vergi kassası (e-kassa): Caspos (SUNMI), working; AzSmart, Omnitech, NBA Technologies, WizarPOS, "Sənəd gözləyir". Bonus: Umico, "Sənəd gözləyir". Cards waiting for a document take no settings, so a shop cannot think it is fiscalising when it is not.
- User-facing "SUNMI" in messages is now "E-kassa". Internal names stay (`sunmi_outbox`, `possistem:sunmi`, `SUNMI_*` codes), because renaming them would touch field databases and journals.

## Research behind the cards

Only Caspos has a protocol we hold (the owner's PDF). AzSmart, Omnitech and NBA have no public API documents; integrators' guides give only connection facts (AzSmart port 8008 and Merchant ID, Omnitech port 8989 and API v2, NBA ports 9898 and 9999 with its "Fiscal services" app). WizarPOS is hardware, so the operator app on it decides the protocol. Umico has no public partner API. Sales on those are built when their documents arrive.

## Checks

- `scripts/qa-real-1934.mjs`: real core, real preload, real screens, no mock of `window.pos`. Sub-categories made in the catalog, a dish placed through the two fields, İçkilər with no products of its own opens, the dish reaches the order in the core, an empty sub-category leads back. `before` shows the problem on 1.9.33.
- `scripts/qa-1934.mjs`: the İnteqrasiyalar screen at 390 and 1366 px.
- `qa-1933.mjs`, `qa-core-1933.mjs`, `sunmi-integration.test.cjs`, signed updates and full native suite (369 cases) pass. `verify-restaurant-package.mjs` passes.

## Not tested

A physical till, or the installer on real Windows.

## Not included

Market is not built: its label and renderer are changed in code and go out with its next build. The owner portal's catalogue stays flat.

## Publication (2026-11-03)

Published at the owner's request: update feed via `artifacts/release-1934/publish.sh`, verified ZIP, download page (EXE SHA-256 `e1d68b2001a6993c65dd2a2d14db04e134b822a90174139ba2c7fc70d3f3e0f4`). Website rollback: `/var/www/possistem/.next-before-release-1934-20261103`, then `pm2 restart possistem`.
