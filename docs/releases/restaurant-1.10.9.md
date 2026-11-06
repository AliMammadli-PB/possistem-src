# Restaurant POS 1.10.9

Kitchen tickets of deliveries, the owner's new management interface, and a redesigned QR order menu for guests.

## Changed

- **The kitchen ticket of a delivery** opens with `*** ÇATDIRILMA ***`, the customer's name and the delivery note ("Qeyd: …", wrapped, not cut). Dish notes print under the dish as before. The address and phone stay on the courier slip only. Hall tables print as before.
- **Unified management interface** (owner's work, `management/`, `scripts/apply-restaurant-management.mjs`): one management rail with searchable module entries and 28 module pictures, a settings picker, operations as a left section list (a drawer under 900 px), Purchases and Sales together under **Ticarət**, Delivery in the main sidebar, **+ Yeni sifariş** inside Delivery instead of the floor's delivery button. Destinations the user has no permission for are left out of navigation and search (before, they stayed visible and answered "Buna icazəniz yoxdur"). QR inbox requests from an earlier session or account can no longer fill the inbox.
- **QR menu cover** in Restoran POS: the owner uploads a logo and a cover from the computer (resized in the till, PNG/JPEG/WebP), or picks one of six ready-made pictures (pizza, grill, burger, salad, pasta, dessert). Without a cover the guest page uses the restaurant's name, logo and colour; ready-made pictures are never shown unless chosen.

## Guest QR menu (site, `/qr/<menu>/<table>/`)

Redesigned with the owner ("Süfrə", the guest's laid table):
- The menu starts in the first screen. Every category is a section; sticky tabs follow the scroll; search covers all sections.
- Dishes are rows with round plates, one tabular price column, the add button on the right. A dish with nothing to choose is added in one tap; dishes with options open a sheet with required/optional groups.
- Photo-less menus have no picture column; a menu with some photos gives the others an empty plate, never a letter or placeholder icon.
- The restaurant's colour carries the table band, the active tab, chosen items, the basket bar and primary actions only. The restaurant's name, logo and table stay in the sticky header.
- Chosen dishes land as plates on the basket bar ("Səbət · N", "<table> süfrəsi"). The order status shows Sent → At the till → Accepted.
- Fonts Bitter and Onest are served from the site (both carry ə, ğ, ı, ş and ₼).

## Technical

- API delta: `lib/qr-menu.js` (logo and cover accept the till's resized images as data URLs up to 300 KB, or HTTPS). No migration; schema 72.
- `tests/unit/locked-visible.test.ts` follows the new navigation rule.

## Checks

- Native suite 394 cases with the delivery kitchen ticket test. Real core: kitchen ticket and courier slip text of a delivery with notes.
- `qa-management.mjs`, `qa-delivery-names.mjs`, `qa-cloud-restore-1108.mjs`, `qa-local-shared-categories1936.mjs`, `qa-cloud-backup.mjs` pass on the assembled till (130/130 patches).
- `website/scripts/qa-qr-menu.mjs` passes in Chromium and Firefox at 360, 390, 768 and 1366 px. Impeccable detector: no findings; finish review: ship for the scored fixes.
- API `qr-menu.test.ts`: 5/5. Unit tests: the same 24 known failures as 1.10.8.
- Not checked: a real Windows till and printer, guests' real phones.
