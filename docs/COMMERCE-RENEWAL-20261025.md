# Commerce and renewal reminders — 25 October 2026

## Behavior

The blue/navy identity and Montserrat are preserved. Hardware is a compact inventory in admin and a purchase catalog on the website. Admins enter positive prices with up to two decimal places (comma or point); clearing a price withdraws it from sale. No prices were invented or automatically published. Unpriced products say “Hələ satışda deyil”. Public stock includes reservations; the cart no longer assumes 99 units when the API omits stock.

The cart supports quantities, stock limits, line totals, total price, removal, confirmed clearing, continued shopping and order history. Totals use integer minor units; the server quote remains authoritative. Refresh failures preserve the cart and explain stale information. Historical paid orders no longer empty a new cart: only the locally recorded checkout for that customer consumes purchased quantities, once, after verified payment; replacement cart lines survive.

Customer `/pos/app/sifarisler` shows product orders, payment/fulfillment states, items, quantities, delivery details and totals. Search/filter and cursor pagination expose older orders. The cursor preserves PostgreSQL microseconds and uses the UUID for timestamp ties. Subscription history stays separate.

Customer-scoped notifications persist in `owner_notifications`. Authenticated website customers see a bell. The customer console bell adds unread counts, previews, read actions and destinations. Reads use customer authentication/CSRF and cannot modify another customer's notices. Each material shop payment/delivery state creates one notice.

The server worker checks every 30 seconds and records one renewal notice per subscription/paid-until cycle in `(now, now + 72h]`. Expired/disabled subscriptions do not produce future-charge notices. Unique keys prevent duplication across parallel workers and restarts. Dates use Asia/Baku. POS status responses carry the notice; Market and Restaurant show it even for otherwise active paid subscriptions.

Market desktop offers automatic monthly card subscription only and opens a trusted handoff in automatic mode. The website/customer console retains an explicit one-month manual fallback. Consent, price version, signed confirmation, idempotency, calendar-month grants and expiry enforcement remain. PAN/CVV is not stored in Possistem.

## External activation still required

At verification Epoint private key was absent and `EPOINT_LIVE_VERIFIED=false`; payments/recurring stayed disabled. The latest Epoint email only confirmed submission of the API connection request. No real charge, refund, card enrollment or entitlement extension was made. The separate reusable 1 AZN private test invoice remains separate.

After Epoint approves API access, install its private key in the protected server environment; confirm Card Storage/recurring permission; verify a controlled real payment, callback/status and refund; confirm seller/terms information; then enable payments/recurring in admin. Keep enforcement off until customers can pay. A redirect or unsigned callback must never activate a month.

## Validation

- API, admin, customer console, Next website and Windows packages built successfully.
- 37 isolated PostgreSQL/server tests passed: three-day boundaries, parallel reminder deduplication, new cycles, order notices, ownership, reads and lossless pagination. Gateway transport was a fixture; production financial records were not used.
- 8 existing desktop billing/signed-update security tests passed.
- Chromium 151.0.7922.34: customer views 390/768/1366 px; cart, order detail, notice reads, consent reset, auto/manual payloads and comma-decimal admin pricing. Authenticated UI tests used explicit browser response fixtures. Historical paid-order navigation preserving a new cart was checked.
- Market component at 360 px: automatic-only choice, three-day notice and handoff mode. Real Windows hardware and bank recurring debits were not claimed as tested.
- Live public storefront/cart and unauthenticated API denial checked after publication. No matching active account for the previously named customer was available for a temporary live session; no account/password was reset.
- Setup manifests verified with the pinned Ed25519 key; Setup SHA-512 and Portable SHA-256 matched published files.

Screenshots are outside Git in the parent workspace `artifacts/commerce-20261025/`; authenticated screenshots use fixture data.

## Release and recovery

Market POS 1.5.73 and Restaurant POS 1.9.15. Canonical source is `main-source`, GitHub `possistem-src` main. Authenticode certificates remain unavailable; Windows may show SmartScreen. Update authorization is separately signed with the protected Ed25519 key.

Migration `0047_commerce_notifications.sql` adds a unique index; no customer/billing data was reset. Full DB backup and old API dist are `/var/backups/possistem/commerce-20261025/` on the host. Old owner/admin dist trees are `.commerce-20261025` beside active `dist`; old Next build is `/var/www/possistem/.commerce-20261025/.next`. Directories were exchanged atomically. Prior feeds are `latest.yml.bak-before-1.5.73` / `latest.yml.bak-before-1.9.15`; restore matching previous artifacts/feed together if rollback is necessary.
