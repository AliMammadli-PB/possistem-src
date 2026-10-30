# Stable publication — 2026-10-30

Restaurant POS 1.9.20 and Market POS 1.5.76 were promoted from manual downloads into the primary update feeds at the user's request. The binaries are unchanged from the billing-access releases tested on 2026-10-29.

The publication tool checked source/runtime versions, build receipts, full installer SHA-512 values and public availability of the Ed25519-signed version manifests before switching latest.yml. Prior feed manifests are kept as latest.yml.bak-before-1.9.20 and latest.yml.bak-before-1.5.76. Existing installer files and manual ZIP copies remain available.

The website download page now links to the primary installer URLs and labels the releases stable. Windows Authenticode certificates are still absent; that remains distinct from the signed update manifests and is disclosed on the download page.

Validation: website production build; signed-update security tests (3 passed); billing-expiry regression tests (3 passed); public download links, versions, manifest signatures and installer sizes. No new card charge, physical printer test or fresh Windows installation was performed during promotion.

Website rollback: /var/www/possistem/.next-before-release-20261030. Restore the prior directory and restart the possistem PM2 service if needed. Database and API behavior are unchanged by this publication.
