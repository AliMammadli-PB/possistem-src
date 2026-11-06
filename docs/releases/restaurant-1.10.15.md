# Restoran POS 1.10.15

Includes the owner's unified management UI and the guest QR menu in the current 1.10.9 source. The QR menu follows the owner's “Süfrə” design: sticky category navigation, dish rows, plate basket and cashier confirmation status. Logo upload, a custom cover or one of six optional food covers remain in Settings → QR ordering. Menu prices and modifiers still come from the POS.

Additional fixes:

- The guest header shows the full logo inside its round mark instead of cropping it.
- QR category navigation remains usable if IntersectionObserver or element scrollTo is unavailable. Reduced motion is respected for category scrolling.
- Broken cover images disappear while the menu remains usable.
- Language, search and category touch targets are at least 44 px high.

No database migrations or payment/fiscal changes in this release. Existing customers' menus, accounts and saved POS data are preserved.

Build, publication and verification evidence is recorded after the checks finish. Real Windows hardware and printer checks are not claimed by browser tests.

## Verification and publication — 2026-11-06

- All five POS TypeScript checks passed. Restaurant C++ Release compiled with MinGW-w64; native tests: **394 cases / 3267 assertions passed** under Wine.
- QR runtime and API schema tests: **5/5 each**. API QR module SHA-256 matches the running server (`bea5edc34cba6ca597da50667e59806933c7bdedf4e20dd7c80100b116e76ffd`); no API restart or database migration was needed.
- Isolated native/renderer delivery test passed; logo and cover upload, publish/reload, six presets and SVG rejection passed. Main management/navigation/QR inbox regression passed on 12 layouts.
- Guest workflow tested at 360, 390, 768 and 1366 px in Chromium **151.0.7922.34** and Firefox **153.0**, against a production Next build and the deployed site with intercepted fixture API requests. No customer orders were created. Tests cover required modifiers, basket totals, accepted status, offline till, lost-response retry, broken cover and missing IntersectionObserver.
- General JS unit suite retains the same **24 known failures** documented in 1.10.9; **273 passed**. This release does not claim a clean full unit suite or a physical Windows/printer run.
- NSIS installer and full public download were checked with 7-Zip; downloaded EXE SHA-256 matched the local build. ZIP CRC and embedded EXE hash were verified.
- EXE bytes: **359830549**. SHA-256: **d30552e3a1e32b60a8c76fcc52e738c516f2900a42afb9f3ec501a2c03124b32**.
- Windows Authenticode certificate remains unavailable, as disclosed on the existing download page. The updater manifest is signed with the protected Possistem Ed25519 key; the publisher checked the uploaded manifest and server EXE hash before switching the feed.
- Feed: `https://possistem.az/pos-updates/latest.yml`. Setup: `https://possistem.az/pos-updates/Possistem-Setup-1.10.15.exe`. ZIP: `https://possistem.az/pos-updates/Possistem-Setup-1.10.15-verified.zip`.
- Website rollback: `/var/www/possistem/.next-before-release-11015-20261106`. Feed rollback: `/var/www/pos-updates/latest.yml.bak-before-1.10.15`. The 1.10.9 installer is retained.
- Stable release metadata registered in PostgreSQL as `stable / 1.10.15`; the previous matching row was backed up under `/opt/possistem-pos-control-backups/release-11015-20261106`. Other release rows and all customer records were left intact.
