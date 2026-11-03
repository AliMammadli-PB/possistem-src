# Restaurant POS 1.9.35

## New

- **Full cloud backup.** The whole POS database and the product pictures go to the server every 6 hours while the till is open and online. Sales sync sends summaries only, so until now no full copy was on the server for any customer, and Premium promised one. Off until the superadmin turns it on for a licence in the customer page; Premium provisioning turns it on. The server checks each copy, encrypts it and keeps the last 8 plus one a day for 30 days, at most 1 GB per till.
- **Restore on a new computer.** Download `.posbackup`, then Ehtiyat nüsxə → Fayldan yüklə, preview and PIN. The file opens only under the same account.
- **One category tree.** Menu and warehouse categories are now the same list (migration 067). A good on sale files under its dish.
- **Catalogue.** "+ Alt kateqoriya" opens a dialog and can move ready products in. A category can take ready products from elsewhere. Order screen lists all top categories in a compact rail.
- **Staff screen.** People, role, branch, warehouse and salary in one place. Employees no longer appear among partners. The local administrator account is hidden from the staff and partner lists.

## Fixed

- **Restoring a backup brought the old computer's licence and identity with it.** A restore now keeps this till's own licence, including for USB backups. It works on a copy and migrates it first, so a backup that cannot be read leaves the till as it was.

## Technical

- `routes/cloud-backups.ts`, `cloud-backup.cjs` (also in the till as `cloud-backup-format.cjs`), tables made at runtime. Data in `/var/lib/possistem-pos-control/cloud-backups`.
- Device id and fingerprint authenticate the upload, as the sales sync does. No owner login needed. A LAN station does not upload.
- Bundles cap at 60 MB (nginx takes 64m). Pictures past 36 MB are left out and counted in `missingAssets`. A lost picture is counted, never a refusal.
- Not in a backup: receipt logo file, e-kassa journal, display preferences. Market, Geyim, Aptek and Topdan do not have it.

## Checks

- Full native suite under Wine: 377 cases pass. `verify-restaurant-package.mjs` passes.
- `scripts/qa-core-1933.mjs`, packaged core: tills on the diverged 1.9.25, live 1.9.32 and live 1.9.34 all reach schema 67 with a backup; 067 on a shop with same-named categories, a sub-category, a deep warehouse tree, goods and a recipe leaves prices, stock and recipes alone.
- `scripts/qa-cloud-backup.mjs`, real core: snapshot on the real schema, restored on a second computer, core starts again, data and picture present, its own licence kept.
- `platform/apps/api/scripts/cloud-backup.integration.mjs`: real route and till client on PGlite. `cloud-backup.test.cjs`: format, encryption, limits.
- `qa-real-1934.mjs` (updated for the new dialog), `qa-1933.mjs`, `qa-1934.mjs`, `qa-local-shared-categories1936.mjs`, `qa-local-staff.mjs`, signed updates and `sunmi-integration.test.cjs` pass.

## Not tested

A physical till, the installer on real Windows, an upload to the live API (no licence has it on yet, so its tables and folder appear on first use), the admin section with a real login, a slow shop connection.

## Not included

The owner portal is not rebuilt ([portal source not reproducible]), so owners do not see downloads yet; the superadmin can download. Market and the other tills. Copies sit on the same server as the site.

## Publication (2026-11-03)

Published at the owner's request through `artifacts/release-1935/publish.sh`. EXE SHA-256 `5cbd41516fee13211cb5e8f050db4fca41c57b3188afcf063c4ec503514156c4`; a full download from the public URL matched the signed manifest.

Rollback:
- API: remove `/etc/systemd/system/possistem-pos-control.service.d/zzzzzzz-workspace-1935.conf`, `systemctl daemon-reload`, restart the service.
- Admin panel: `apps/admin-web/dist-before-backup-1935`.
- Website: `/var/www/possistem/.next-before-release-1935-20261103`, then `pm2 restart possistem`.
