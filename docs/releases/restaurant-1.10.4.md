# Restaurant POS 1.10.4

Includes 1.10.3. Fixes the gaps found checking 1.10.3 against the customer's list.

## Fixed

- **A dish with its own recipe, added through its stock card, did not take its raw materials out of stock.**
  - Migration 070 turns such lines into recipe parts on every till, same quantity. Lines that would close a cycle or pass 8 levels stay as they were.
  - `recipes.save` does the same on every save.
  - In the editor, picking such a dish from "Anbar xammalı" adds it as "Hazır resept".
  - **After this update the stock card of such a dish no longer goes down when a dish containing it is sold; the raw materials do.** A shop that prepares a batch ahead and counts it on its card needs to know this. It was the owner's decision.
- **A courier showed "1 yolda" for an order the guest had paid.** A paid order is no longer counted. An order whose money the courier still holds counts until handed in.
- **A renamed branch stayed under its old name when another object had the new name.** An empty namesake and its warehouse go to the archive as "[arxiv ...]" and the object holding the tills takes the name. A namesake holding data is left alone and Kassalar shows a warning. It is looked at again every 10 minutes or on restart.
- **Xərclər** no longer offers edit and cancel on a salary's cash row, which the core refused anyway.

## Technical

- Migrations 068, 069, 070, schema 70. `apply-restaurant-1104.mjs`.
- `cashObjects.syncRestaurantBranch`, `hasReferences` in `CashAccountHandlers.cpp` follows `scripts/repair-branch-object.py`, leaving out `audit_logs`, `sync_outbox` and `sync_inbox`.

## Checks

- Full native suite under Wine: 386 cases pass, with new cases for stock cards in recipes, the courier count in both pay modes, and both namesake outcomes.
- `scripts/qa-core-1933.mjs`, real core: tills from the diverged 1.9.25, 1.9.32, 1.9.34 and 1.10.2 start and reach schema 70 with a backup. A 1.10.2 database with salaries, transfers, payments and recipes keeps its money, gets its documents and converts its recipes; a recipe cycle stays untouched.
- `scripts/qa-local-shared-categories1936.mjs`, real core and screens, including a prepared dish picked from the stock list.
- `verify-restaurant-package.mjs`.

## Not tested

- A real Windows till or a customer's database. The object fix on Pizza Home is only proven once that till updates.
- The warning banner in Kassalar on screen. The setting behind it is tested.
- The deposit on a physical till, and the deposit with SUNMI fiscal on a real device.

## Not included

- A fixed deposit amount per table: the cashier types it.
- The owner portal: `warehouse-portal.ts` and `WarehouseDocuments.tsx` are committed, not deployed, so new document types there are unchanged.
- Goods already on sale stay in "Mallar" until unticked.
- Market and the other tills.

## Unit tests

`tests/unit` reports 24 failures, the same number as on the 1.10.2 commit: Market bridge tests and suites that need assembled files such as `branch-presence.cjs`. No failure comes from this release. The run was read only after the publish had gone out, because both were sent in one command; the comparison was made straight after.

## Publication (2026-11-05)

Through `artifacts/release-1104/publish.sh`. EXE SHA-256 `44d1fadaa7fc996ca57bae335280093d494eaf5cec784b4adf0ee7925cf715b4`, 356285900 bytes. Site build `3f6G9U32OWiumTr5ibjOc`. Website rollback: `/var/www/possistem/.next-before-release-1104-20261105`, then `pm2 restart possistem`. A till that has updated cannot go back: migrations are forward-only, so a bad build means a new version.
