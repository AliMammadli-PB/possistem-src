# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary: the **market owner / müdür**, often on a phone, checking the shop from the office, car, or storeroom while tills run in the shop.
- Secondary: cashiers and warehouse staff at the Windows Market POS till. They do not use this panel to sell; they need the same product photo the owner just placed.

## Product Purpose

This is the Market POS **owner panel** (`/marketpos` and the customer portal when the account is market-only). It is how the müdür sees the live shop and changes the catalog. Success is: one screen that answers who is on which kassa, whether that kassa is working, how much has been taken today, what the goods look like, and the ability to add stock or a photo that the till will still show when the internet drops.

## Positioning

Not a restaurant floor board and not a generic SaaS dashboard. The mechanism is **central catalog + live till heartbeat**: the owner writes products and photos here; every till syncs them locally (photo kept as WebP on disk plus its URL) so checkout keeps the picture offline.

## Operating Context

- Phone or laptop browser at possistem.az/marketpos (and /pos/app when the license is market-only).
- Windows Market POS tills in the shop, often flaky internet.
- Currency AZN; copy in Azerbaijani (az), with the till also speaking ru/en.
- Catalog work happens as overlays on the same page, not as a second app.

## Capabilities and Constraints

- Confirmed: live till snapshot (open/closed registers, operator name, daily cash/card/sales), central stock, owner product CRUD, stock increment, remote X/Z, photo from the phone that the till must display.
- Photo path: owner uploads → server URL → till fetches that URL → stores WebP in local `catalog-media` and keeps the URL so it can refresh when online and still render when offline.
- Confirmed: no restaurant chat, WhatsApp bot, or table map on this surface.
- E-kassa / fiscal is later; do not claim it here. [open]
- Dual restaurant+market accounts keep restaurant chrome on /pos/app; /marketpos is always market-only.

## Brand Commitments

- Name: **possistem** (lowercase wordmark).
- Binding accent: **blue** (existing brand `#0a4f9c` / action `#3b82f6`). Do not add a second primary hue.
- Voice: direct Azerbaijani shop language. Controls name the action.
- Logo already in the portal public assets.

## Evidence on Hand

- Live panel: https://possistem.az/marketpos/
- Heartbeat already carries `registers[]` (name, open/closed, operatorName, salesMinor), `dailySalesMinor`, cash/card, low stock, top products.
- Till already stores picked photos as `market-pos://media/…` JPEGs; remote URL cache to WebP is the missing half.
- Do not invent earnings, staff names, or product photos in marketing claims; UI may show live zeros and empty states.

## Product Principles

1. The müdür’s first screen is the shop, not a settings menu.
2. A photo that only exists in the browser has not been placed; the till must hold a local WebP.
3. Catalog edits stay on this page as overlays so the live picture is never left.
4. Offline at the till is a product promise; the panel may need the network, the kassa must not.
5. Blue is the only accent voice.

## Accessibility & Inclusion

No separate WCAG contract. Keyboard-reachable overlays, visible focus, contrast on blue fields, az copy complete. [inferred baseline]
