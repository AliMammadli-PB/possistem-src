# Customer portal — compact interface, 2026-10-23

Source snapshot of the deployed owner portal at `/opt/possistem-pos-control/apps/owner-web`.

The compact interface replaces `receipt.css` with `portal-ui.css`, retains the blue/white brand, adds a visible theme switch, reduces navigation and card spacing, and styles the inventory and profile forms consistently. Theme preferences and existing application behavior are preserved.

## Build

Use Node 20 or newer, then `npm ci` and `npm run build`. The application base is `/pos/app/`.

The normal owner portal build is included here. Alternate chat/market builds require their deployment-specific Vite configurations and public directories. Before deploying, preserve `public/warehouse-20261020/` from the current deployment: it contains the separately built native warehouse clients and cloud bridge. Do not replace those clients with an empty directory. Keep the root brand asset `/assets/brands/logo.png` available.

Build into a staging output directory, verify it, retain previous hashed assets for open browser sessions, and exchange it with `dist` only after success. The production rollback copy for this release is `/opt/possistem-pos-control/backups/customer-compact-20261023/dist`.

## Verification

TypeScript and Vite production builds passed locally and on the server. Chromium checks used explicitly mocked account/branch fixtures at 390, 768, 1366 and 1920 px in both themes, including no page-level horizontal overflow, dashboard text contrast (at least 4.5:1), inventory search/filter, mobile drawer/Escape, persisted theme selection, and profile form rendering. No customer financial transactions were changed during these checks.

The retained implementation and verification artifacts are in the task workspace at `artifacts/customer-compact-20261023/`.
