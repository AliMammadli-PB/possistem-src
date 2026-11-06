# Restoran POS 1.10.16

Unifies cash management at **Kassalar**. Finance and old `/admin/cash` bookmarks now open the same named-account workspace. Clicking a card opens a transfer form without sending money. The card's explicit Transfer button and overflow menu expose transfer, all cash movements, edit and archive. Forms show current available balance, today's receipts and receipts since account creation. **Transfer all** fills only the current balance, and still requires confirmation. Read-only users keep history access without mutation controls.

Full movement history now projects approved sales and completed refunds alongside existing opening, transfer, salary, expense and other movements. Mixed tender allocations and tips follow the existing native cash balance rules. This is a read-only view: existing balances are not reposted or migrated. Period opening, money in/out and closing are calculated across the entire period before list filtering or the 5,000-row cap. Legacy native API callers retain their previous response by default. The existing native balance, permission and transactional transfer protections remain authoritative. Repeated UI submissions are locked and retry uses the same native idempotency key.

Completes the Settings change: **Restoran**, **Sistem**, and **Yeniləmə** are separate destinations. Updates displays the installed version, check/download progress and installation action. Failed checks recover instead of remaining busy. Update banners open that destination. A generated blue/white transparent PNG is included; its generation prompt is saved at `restoranpos/management/update-icon-prompt.json`.

No database migration, fiscal/payment logic change or production customer-data correction is included. Market's shared builders retain register identity and shift/X–Z access; no new Market installer is published.

## Validation

- All five POS TypeScript checks passed.
- Native cash acceptance: **4 cases / 47 assertions**. Full native suite: **398 cases / 3314 assertions passed** under Wine. The version-only native rebuild is checked separately before packaging.
- Shipped renderer cash acceptance passed in Chromium **151.0.7922.34** at 1536×816, 1366×735, 768×1024 and 390×844. Checks canonical/legacy navigation, card/overflow behavior, no implicit transfer, transfer-all, overdraft, duplicate clicks, failure/retry identity, history/search and permissions.
- Management/updater suite passed across **16 layouts**: update checks and failures, progress, install, banner routing, explicit settings destinations, QR transitions, sidebar and hidden permissions.
- Shared cash build compatibility test passed, including immutable Market terminal identity and retained shift/X–Z action.
- Full desktop assembly passed **130/130** owner patches, including both remote frame variants. Generated source remains reproducible after assembly.
- The existing general JS suite has 24 known baseline failures as documented in 1.10.15; this release does not claim that suite is clean. Real Windows cashier/printer/bank hardware is not emulated by these tests.

Publication hashes, installer verification, rollback paths and release registration are recorded after packaging and deployment complete.

## Publication — 2026-11-06

- Versioned native Release rebuild passed; the rebuilt 1.10.16 core again passed **398 cases / 3314 assertions**. Final desktop and management browser suites passed after assembly.
- NSIS Setup and full public download passed 7-Zip integrity checks. Local and remote ZIP CRC plus embedded installer SHA-256 were verified. Packaged ASAR has version 1.10.16, unified cash controls, the updater panel/PNG, `branch-presence.cjs`, and the updater dependency closure.
- EXE: **359992379 bytes**. SHA-256: **e9faa9ca6f5d18d3a935afcc3b0957fb90f687bb9934537eb540658a9ef04080**.
- Windows Authenticode certificate remains unavailable, as disclosed on the download page. The release retains Electron fuses and embedded ASAR integrity. The updater manifest is signed by the protected Possistem Ed25519 key and verified from its public URL before feed switch; the exposed signature was verified again after publication.
- Setup: `https://possistem.az/pos-updates/Possistem-Setup-1.10.16.exe`. ZIP: `https://possistem.az/pos-updates/Possistem-Setup-1.10.16-verified.zip`. Feed: `https://possistem.az/pos-updates/latest.yml`.
- Website production build passed; public `/download/pos/` points to 1.10.16 Setup/ZIP and retains Market POS 1.5.78. The previous website's static chunks are retained to support already-open tabs.
- Rollback: `/var/www/possistem/.next-before-release-11016-20261106` and `/var/www/pos-updates/latest.yml.bak-before-1.10.16`. The previous 1.10.15 installer is retained.
- PostgreSQL release row `stable / 1.10.16` is published with the same artifact URL and checksum. Prior matching-row backup: `/opt/possistem-pos-control-backups/release-11016-20261106`. No customer records or schemas were modified. No API deployment/restart was required.
- Desktop **Possistem NEWEST** remains linked to this source and `out/` build; restart an already-running instance to load the updated renderer.
