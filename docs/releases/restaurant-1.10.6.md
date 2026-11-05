# Restaurant POS 1.10.6

Found on a real customer database, from its cloud backup with the owner's permission, tested on a copy. The repairs run by themselves on every till.

## Fixed

- **A recipe inside a recipe still took nothing out of stock when the dish had been archived and made again.** The recipe screen before 1.10.3 switched off a dish's stock card when its recipe was saved, so the stock list hid the live card and offered the card of the archived dish of the same name, which has no recipe. 18 such cards on that till.
- **Orders carried by a courier took stock from the main warehouse.** The branch was found through the payment, and those orders have no payment row. They now use the branch of the till closing them.
- **A paid bill could fail on a switched-off stock card.** Selling and correcting a sale no longer refuse one.
- **Archived warehouses showed on the stock screen,** and it opened on the first warehouse in the list. It now lists active ones and opens on the till's own.

## New

- **Automatic data repair at every start** (`services/DataRepair.cpp`). It changes nothing when all is well, finishes or rolls back, never stops a till from opening, and records what it did in `data_repairs` and the audit log.
  - A recipe line on the card of an archived dish moves to the one live dish of that name. With two live dishes of the name it stays, because which was meant is not known.
  - Live dishes with a recipe get their card back.
  - Card lines of dishes with a recipe become recipe parts. A line that would close a cycle stays.
  - The card of an archived dish leaves the stock lists, unless it holds goods or a live recipe still uses it. Also done when a dish is archived.
  - **One warehouse per branch.** A till with one branch folds "Əsas anbar" into the branch's warehouse: stock, lots, rules, staff access, documents and movement history. Totals do not change. It stays apart when a transfer document involves it. Several branches keep theirs.
- **The server keeps only a till's newest cloud backup.** Older copies and files go once the new one is verified and stored. A backup with the same data stays one copy. **A mistake noticed later can no longer be undone from an older server copy.** The owner's decision.

## Technical

- Migration `072_data_repairs.sql`; schema 72. It also gives every till a pre-migration backup before its first repair. Later repairs have no separate backup and rely on the transaction and the log.
- `warehouses.list` lists active warehouses and returns `homeWarehouseId`.
- API delta: `routes/cloud-backups.js` only. Admin panel: wording.

## Checks

- Full native suite under Wine: 393 cases, with `data_repair_test.cpp`, a courier order's warehouse, and a second run changing nothing.
- Real core on a copy of the customer's newest backup: payments, order totals, movement count, total stock and raw material all unchanged; one warehouse left; the recipe on the archived card became a part; the dish now takes flour and the second raw material; a dish with a sauce picked from the stock list takes both; a second start repairs nothing.
- `scripts/qa-core-1933.mjs`: tills from the diverged 1.9.25, 1.9.32, 1.9.34 and 1.10.2 reach schema 72.
- `scripts/qa-local-shared-categories1936.mjs`, `scripts/qa-cloud-backup.mjs`, `cloud-backup.integration.mjs` on a real Postgres engine, `verify-restaurant-package.mjs`.
- `tests/unit`: 24 failures, the same list as on 1.10.5.

## Not tested

- A real Windows till. The repair is proven on a copy, and on the customer's till only once it updates.
- A courier order through the whole dispatch flow with a branch warehouse; the test closes the order at the stock layer. On the copy no courier sale was run.
- Paper out on a real printer, as in 1.10.5.

## Not included

- Past sales are not recalculated, so stock already wrong stays as it is. Dishes with no recipe still take their own card, which is why they can show a negative balance.
- A dish with two live versions of the same name needs a person to choose.

## Publication (2026-11-05)

Through `artifacts/release-1106/publish.sh`: API delta workspace `.workspace-20261105-1106`, admin panel, feed, verified ZIP, download page. EXE SHA-256 `fc1e9b6c89ee614a8224a6b3819945aa905098967e0c0b5a6e84c39e547ecc87`, 356300487 bytes. Site build `DFBZBmdfkVdoNxZme2QQ7`. Rollbacks: website `/var/www/possistem/.next-before-release-1106-20261105` then `pm2 restart possistem`; API remove `zzzzzzzz-workspace-1106.conf`, `systemctl daemon-reload`, restart; admin `dist-before-1106`. Older backups disappear on each till's next upload. A till that has updated cannot go back: migrations are forward-only.
