# Restoran POS 1.10.18

Adds an administrator-only operational reset that keeps the menu, goods, recipes, size variants, prices, users, printer configuration and licensed customer identity. The admin customer page previews the selected till, requires the exact customer name and a reason, and reports completion only after the native acknowledgement. Offline or unsupported tills cannot receive a destructive reset. A consistent local SQLite backup, protected-catalogue hash, explicit operational-table allowlist, foreign-key and integrity checks precede the database swap. Command replay does not erase later activity. Server snapshots are cleared only after the native reset succeeds, with a timestamp cutoff preserving subsequent activity.

The cash transfer dialog explains when another active account is needed. A treasury can transfer to another active account using the existing transactional transfer operation. No artificial cash movement or fake destination is created by this release.

QR item artwork is stored independently of the POS catalogue and fills missing item images without replacing merchant images or changing prices, modifiers or names. Generated transparent PNG originals, web-optimized versions and prompts are retained under `website/public/assets/menus/pizza-home-20261106/`. The website renders category thumbnails. Includes the existing QR automatic refresh, archived-product handling and print-queue messaging work.

## Verification

- Versioned native 1.10.18 Release rebuild: 403 cases / 3363 assertions passed under Wine. Desktop assembly applied 132/132 patches.
- Signed operational-reset client and QR runtime: 10 tests passed. API artwork, QR pricing and version-gate tests: 8 passed.
- Management and updater browser suite: 16 layouts passed. Cash workspace: four viewport sizes passed, including duplicate submission, retry identity, overdraft and read-only permissions. Chromium 151.0.7922.34.
- A protected copy of Pizza Home's cloud backup was reset successfully: 149 menu items, 151 ingredients and 150 ingredient-recipe lines remained unchanged; orders, cash moves and stock movements became zero. SQLite integrity check passed. This was an isolated copy, not the live till.
- Public Pizza Home QR menu: all 123 published items have images; 122 generated artwork mappings were added and one existing merchant image retained. No catalogue document changes were made. Browser checks passed at 390, 768 and 1536 px, including image availability, no horizontal overflow and no page exceptions. No customer orders were submitted by QA.
- API/admin and all five POS TypeScript checks passed. The website production build passed. The reset endpoint rejects unauthenticated access.
- Administrator reset UI acceptance passed against isolated responses: unsupported till blocked, selected till preserved, preview required, exact customer name required, duplicate clicks locked and pending controls disabled. A same-event duplicate-click case exposed an asynchronous state gap, fixed with a synchronous ref lock; the test then passed.

## Live customer status

The requested live Pizza Home reset has **not** been executed. Device `291ed2f4-23e2-400b-9771-2aa07c9778b2` last reported version 1.10.16 at 07:06 UTC on 2026-11-06 and is offline at verification. Update and open the primary POS before running the new preview/reset flow. No destructive command was queued for an offline device.

Protected customer backup and artwork-change receipts are stored outside the repository at `/opt/possistem-pos-control-backups/pizzahome-20261106`, with an additional local protected copy. The operational reset is authorized only for this customer's test data; no other customer's records were reset.

## Deployment and recovery

API/admin backups: `/opt/possistem-pos-control-backups/release-11017-20261106`. Website previous build: `/var/www/possistem/.next-before-release-11017-20261106`. Generated artwork mappings were applied only to Pizza Home's menu and preserve all existing merchant images. Market POS remains 1.5.78. Physical Windows banking, printer and fiscal acceptance is not claimed.

## Publication

- Final Setup: `https://possistem.az/pos-updates/Possistem-Setup-1.10.18.exe`, 360008394 bytes. SHA-256 `05b2c3cfad080c64e17bd381ad802f15d13dac277745df431d5b1d0d18145b03`.
- ZIP: `https://possistem.az/pos-updates/Possistem-Setup-1.10.18-verified.zip`; CRC and embedded installer hash verified. Local installer passed 7-Zip integrity checks. ASAR main/helper/renderer matched the final 132-patch assembly. Windows Authenticode remains unavailable; embedded ASAR integrity, Electron fuses and the signed updater manifest remain enabled.
- Signed update feed and PostgreSQL stable release row point to 1.10.18. Public download page was rebuilt with matching version, size and checksum. A preliminary 1.10.17 artifact is retained; 1.10.18 includes the final QR assembly changes in a distinct version rather than replacing an already-published installer.
- Website rollback before final publication: `/var/www/possistem/.next-before-release-11018-20261106`; feed rollback: `/var/www/pos-updates/latest.yml.bak-before-1.10.18`.
- Desktop Possistem NEWEST points to the final local 1.10.18 source/output. Restart an already-running local instance to load it.
