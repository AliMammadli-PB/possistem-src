# Restaurant POS 1.9.32

Adds "Bütün datanı sil": from a customer's page in the admin panel a superadmin can return that customer's Restaurant tills to a new install.

## How it works

- Admin panel: customer page, Restaurant view. The superadmin types the customer's exact name. One customer at a time; a wipe already running refuses another.
- Each till gets its own signed command, valid for 24 hours. A till off for longer does not wipe; the panel shows "vaxtı keçdi" and it can be sent again.
- Till: the core copies the database to `backups/<name>-before-wipe-<ms>.db`, builds a fresh database, moves the licence and the till's identity across, and restores it over the live one. Then the app restarts the core, signs out and reloads. Other backups and `audit-archive` go at once. The kept copy goes after 30 days, checked on every start.
- Server: once a till reports success, the customer's live sales, reports, products, staff, tables, portal warehouse copies and queued command results are removed. A till not yet wiped sends its own data again until it is wiped.

Removed on the till: sales, orders, payments, shifts, Z and X reports, menu, recipes, stock, purchases, staff, PINs, guests and debts, settings, printers, audit log. A new install's default administrator comes back and must set a new PIN.

Kept: customer account, licence and subscription, payments and invoices, the till's activation and server address (`device.installationId`, `license.controlUrl`, `sync.serverUrl`, `terminal.id`, `branch.cloudName`, `branch.code`, `branch.name`), and the server's record of who wiped what and when.

The method `system.wipeAllData` is in none of the renderer, LAN or portal allowlists, so only the main process can call it, and only for a signed command. A LAN station refuses the command (`E_NOT_HOST`), because its calls would otherwise route to the host.

Not covered: application logs, the browser's local storage on the till, files the owner exported to a flash drive. Market, Geyim, Aptek and Topdan do not have this.

## Checks

- Full native suite under Wine: passes, with 3 new `[datawipe]` cases.
- Real packaged core over its protocol: a till with data, then `system.wipeAllData`, then a restart. New install on the current schema, licence and terminal id kept, one audit entry, copy holds the old data.
- `routes/data-wipe.test.ts`: exact name, no tills, wipe already running.
- Admin panel in Chromium at 390 and 1366 px with a mocked API: the button stays off until the exact name, the payload, every status label.
- Not tested: a signed command end to end on a real till, the restart inside Electron on Windows, or the server cleanup on real rows. The first real use should be on a test customer.

## Publication (2026-11-02)

Published at the owner's request: update feed via `scripts/publish-release.mjs restaurant`; download page and verified ZIP (EXE SHA-256 `343345b713b010185dee0f2a487b3561fd6c5ef0380a2b44b9343d42022c6d0c`); API as `.workspace-20261102-1932` with only `routes/data-wipe.js` added and `app.js` registering it, because the live API differs from this tree in 6 other files; admin panel in place.

Rollback:
- API: remove `/etc/systemd/system/possistem-pos-control.service.d/zzzzzz-workspace-1932.conf`, then `systemctl daemon-reload` and restart the service.
- Admin panel: `apps/admin-web/dist-before-wipe-1932`.
- Website: `/var/www/possistem/.next-before-release-1932-20261102`, then `pm2 restart possistem`.
