# Restaurant POS 1.10.8

Asked by the owner after a real restore test of a customer's newest cloud backup on a fresh computer (all 110 tables came across; the differences were the new computer's own licence and identity). The admin clears the HWID; the customer does the rest.

## New

- **"Buluddan bərpa et" on the till.** On a new computer, once activated, Admin → Yedəkləmə lists the account's server copies (newest of each till, with date, computer name and counts) and brings the chosen one into this computer. The existing restore dialog then takes over: safety copy first, admin PIN, this computer keeps its own licence. No website download, no USB stick.
- **Backup at day close and on quit.** Besides every 6 hours: a copy goes 3 seconds after the Z report / day close, and one when the program closes (at most 20 seconds, skipped if the last copy is under 10 minutes old).
- **The new computer gets the old till's seat.** After the admin clears a customer's HWID, the first new PC within 7 days takes the seat of the till seen longest ago, which is revoked (audit `device.seatHandover`). Before, a one-seat licence refused the new PC because the old till still held the seat. Without a reset, or after the one hand-over, a new PC needs a free seat as before.

## Technical

- API delta, two compiled files: `routes/cloud-backups.js` (`GET /devices/:id/cloud-backup/available`, `GET /devices/:id/cloud-backup/download/:backupId`, device proof, same account only, 6 downloads an hour) and `routes/devices.js` (`handOverSeat` in `redeemWithKey`, applied to the live file by `control-plane/apply-seat-handover.mjs`; mirrored in `devices.ts`).
- Till: `cloud-backup/client.cjs` (`available`, `fetchBackup`), `cloud-backup/ui.js`, `scripts/apply-restaurant-1108.mjs` (main: `backup.cloudList`, `backup.cloudFetch`, day-close and quit backups; preload; backup page opens its restore dialog). Every main edit carries its own guard, since an earlier patch can drop the tail of `index.js`.
- No core or schema change; schema stays 72.
- A revoked old till stops uploading; its last copy stays on the server and is listed for the new computer.

## Checks

- `cloud-backup.integration.mjs` (route + real till client on PGlite): a new computer of the account lists and restores the old till's copy byte for byte with pictures; another account sees nothing and gets `BACKUP_NOT_FOUND`; a bad id is refused; a revoked device is refused.
- `seat-handover.integration.mjs` on the patched live `devices.js`: no reset, a reset older than 7 days, another customer's reset, a free seat → nothing revoked; reset with a full seat → the old till goes once; two seats → the till seen longest ago goes.
- `qa-cloud-restore-1108.mjs`: real core, real preload, backup screen: list, "Bu kompüterə bərpa et", PIN dialog, the old shop's data on the new computer, safety copy taken.
- The newest real customer backup restored on a fresh core before this change: 104 of 110 tables identical, the rest licence, identity and log rows.
- `qa-cloud-backup.mjs`, `qa-delivery-names.mjs`, `qa-local-shared-categories1936.mjs`, `cloud-backup.test.cjs` pass. Unit tests: the same 24 known failures.
- Not checked: a real Windows till, the quit backup during an update install, the hand-over on the live database.
