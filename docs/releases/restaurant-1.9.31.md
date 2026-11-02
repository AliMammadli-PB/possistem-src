# Restaurant POS 1.9.31

Fixes the "Təhlükəsiz rejim" crash loop (`core exited with code 2`) on tills that installed the other Restaurant 1.9.25 build, which was on the feed for a few hours on 2026-11-01. That build left the database at schema 66 with migrations 065/066 that are not in this line, so 1.9.26 to 1.9.30 refused to start with "Database schema version 66 is not represented by the embedded migrations".

On start the core now recognises those two migrations by name and takes the migration history back to 064. The normal upgrade then makes a pre-migration backup in `backups/` and runs this line's 065. Only history metadata is rewound: orders, payments, staff and catalog are untouched.

The columns `menu_items.size_group_id` and `size_cm`, the table `menu_item_components` and the view `menu_item_recipe_expanded` stay on those tills, unused by this line. A later migration must not add these names unguarded. Costed dishes inside a costing, saved on that 1.9.25 build, are kept in the table but do not deduct stock in this line.

## Update first

The app now asks the feed before it starts the core (`update-first.cjs`). If a newer version exists it shows "Proqram yenilənir", downloads it, checks the signature and hash, installs and reopens, so a release that breaks the core can be repaired by publishing a newer one.

- It never locks a till out. The core starts normally when the feed gives no answer in 12 s, on any update error, when the download makes no progress for 60 s, after 10 minutes in total, or after 3 failed installs of the same version.
- A core in `crash_loop`, `core_missing` or `incompatible` asks the feed at once and then every 2 minutes, and installs what it finds without anyone touching the till.
- A till that is working is no longer closed by a finished download in the middle of service. It installs when it is closed, or on its next start.
- Two updater faults are fixed. The install ran 800 ms after the download, often before the 356 MB hash check had finished, and was then never retried. Install on close never worked, because the signed updater pinned `autoInstallOnAppQuit` to false. `secure-updater.cjs` is shared, so the next Market build gets the install-on-close fix too.
- The installer is per-machine, so Windows can still show its UAC prompt.

Nothing else changed from 1.9.30: renderer, roles, till rules and printing are the same.

## Checks

- Real `restaurant-pos-core.exe` under Wine against a database built from the actual SQL of commit 01066c2 (schema 66): 1.9.30 exits with code 2; 1.9.31 reaches `core.ready`, ends at schema 65 with this line's history, keeps the test category and the extra column and table, and writes the backup.
- New case in `native/tests/migrator_test.cpp`, including a second start that applies nothing.
- `npm run test:update-first` (8 cases) and `marketpos/scripts/test-signed-updates.cjs` (3 cases) pass.
- Full native suite under Wine on the same core source: 356 test cases, all pass.
- `verify-restaurant-package.mjs` passes on the installer, and the packaged core repeats the schema 66 result above.
- Real electron-updater, signed updater and gate against the live feed, in Electron on Linux reporting version 1.9.1: 1.9.30 was found, its signature checked, downloaded in 19 s and hash-checked in 644 ms on NVMe; `quitAndInstall` was accepted and the core did not start. Only the NSIS run was stubbed.
- A feed error in the same setup released the gate and started the core.
- Real Electron main process, offscreen on Linux: the gate releases, then the core spawns and reaches `ready`; the progress page renders 42%.
- The whole app could not be tested under Wine: Electron hits a page fault there, and unmodified 1.9.30 does the same.
- Not tested: the installer run with its UAC prompt on real Windows, a physical till or a real customer database.

## Use and rollback

A till stuck on "Təhlükəsiz rejim" still runs the 1.9.30 updater, which has the faults above: it downloads 1.9.31 on its own but may not install it, so such a till can need one manual install from https://possistem.az/download/pos/ over the existing one. The database stays. Version 1.9.30 stays on the server.

## Publication (2026-11-02)

Published at the owner's request without the one-till trial first: update feed via `scripts/publish-release.mjs restaurant` (signed manifest `v/1.9.31/signed.json`, previous feed `latest.yml.bak-before-1.9.31`); download page switched to 1.9.31 with a new verified ZIP and EXE SHA-256 `731eee0a4d8887558154ad6e75d7a4cc9517d262ba4d9ff7e852adc03b64cac2`. Website rollback: `/var/www/possistem/.next-before-release-1931-20261102`, then `pm2 restart possistem`.
