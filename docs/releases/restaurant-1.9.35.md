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
