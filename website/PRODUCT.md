# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Restaurant guests** scanning the QR code on their table with a phone: they want to see the menu, choose dishes with options, and send the order to the till without waiting for a waiter. Often one hand on the phone, in restaurant lighting, in Azerbaijani, Turkish or English.
- **Restaurant owners** using Restoran POS: they publish the menu from the till and set the restaurant's name, short description, logo, cover picture and accent colour for their guests' page.
- **Shop and restaurant owners** evaluating Possistem on the public site (possistem.az): downloads, demo, plans.

## Product Purpose

Possistem sells Windows POS programs (Restoran, Market, Geyim, Aptek, Topdan) for shops and restaurants in Azerbaijan. The QR order page lets a restaurant's guests order from their table straight into the restaurant's till; the till accepts or rejects each order. Success on that page: a guest finds a dish and sends a correct order quickly, and the page feels like the restaurant's own.

## Positioning

The QR menu is the restaurant's live till menu, not a separate website: prices, availability, option groups and the table come from the POS, and orders land in the till's QR inbox.

## Operating Context

- URL `/qr/<menu token>/<table token>/`, opened from the printed table QR code.
- Data comes from the POS: categories, products (name in az/tr/en, description, price, picture, availability, option groups with min/max), table label, whether the till is currently taking orders.
- Payment and service charges happen at the till; the page says so.

## Capabilities and Constraints

- White-label per restaurant: name, description, logo, optional cover picture, accent (blue, green, burgundy, amber), layout (cards/list) are set in Restoran POS.
- Many restaurants have no product photos; the page must look complete without them.
- Languages: az, tr, en, chosen on the page.
- Built in the Next.js site (`src/components/qr`), served by the same server as possistem.az.

## Brand Commitments

- The page carries the **restaurant's** identity (logo, colour, name). Possistem appears only as a small signature at the end. (Owner, 2026-11-06.)
- No generic stock food pictures by default: a restaurant without its own pictures gets a page built from its name, logo and colour. Ready-made scene pictures may be offered to the owner as an explicit choice in the POS, never shown on their own. (Owner, 2026-11-06.)

## Evidence on Hand

- Six generated scene pictures in `public/assets/qr-menu/` (pizza, grill, burger, salad, pasta, dessert); prompts in `artifacts/qr-redesign/image-prompts.json`. They are not any restaurant's food.
- No real restaurant menus or photos in the repository; screenshots and tests use invented sample menus, which must not appear as real customers.

## Product Principles

- The menu is the page: the first screen shows dishes, not an introduction.
- A missing picture is normal, not an error.
- Every price and option the guest sees is what the till will charge.
- The restaurant's identity leads; Possistem stays in the background.

## Accessibility & Inclusion

Guests on any phone, often at arm's length in dim light: readable sizes, 44 px touch targets, keyboard and screen-reader use, reduced motion respected.
