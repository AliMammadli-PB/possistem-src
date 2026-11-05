# Restaurant POS 1.9.36

## New

- **A note on a dish in the order.** "+ Qeyd" on a line in the cart opens a field ("göyərtisiz, mayonezi bol"). The note shows in the cart, on the kitchen ticket as "QEYD: …", on the customer's receipt as "Qeyd: …" and on the kitchen screen. Editable until the line goes to the kitchen, then read-only. Sending waits for a note still being saved. Adding the same dish again makes a separate line, so one burger can differ from the next.

## Technical

- The core already stored and printed notes (`orders.setItemNote`); the order screen had no field for them. `scripts/apply-restaurant-1936.mjs`.
- `ReceiptBuilder::kitchenTicket` prints "QEYD: " and wraps long notes, instead of an unwrapped "! ".

## Checks

Published without test runs, at the owner's request: "test falan etme". Only the bundle parse and `verify-restaurant-package.mjs` were run. The note field, its save and the printed ticket have not been run even once.

## Publication (2026-11-03)

Through `artifacts/release-1936/publish.sh`. EXE SHA-256 `0e1138fcc4c5c67b2d6d1ff1c07409113627f6912dfae2d7096bad04f2aa9496`. Website rollback: `/var/www/possistem/.next-before-release-1936-20261103`, then `pm2 restart possistem`.
