# Restaurant POS 1.10.7

Asked by the owner after 1.10.6: a delivery table should carry the guest's name, and the "Çatdırılma" button should not sit in the top right corner.

## Changed

- **A delivery table shows the guest's name instead of "1", "2".** On the floor tile and in the order screen title. A correction in the delivery invoice renames it. A delivery without a name keeps its number; hall tables are unchanged.
- **The "Çatdırılma" button stands on the left,** right after the area tabs, instead of the top right corner.

## Technical

- `tables.list` / `tables.get` return `deliveryName`, read from the open delivery (`TableHandlers.cpp`). The table's own label stays `Ç-N`: delivery tables are reused, and old sales show the table label, so writing the name into it would put the next guest's name on earlier sales.
- Renderer patch `scripts/apply-restaurant-1107.mjs`; tile style in `possistem-system.css`.
- No migration; schema stays 72. No API or admin panel change.

## Checks

- `scripts/qa-delivery-names.mjs`: real core under Wine and the real screen at 1536 and 1000 px. Name on the tile, nameless delivery keeps its number, a hall table keeps its number, an invoice correction renames the tile, the table label stays `Ç-1`, the button sits right after the area tabs, no page errors.
- Full native suite: 393 cases. `qa-local-shared-categories1936.mjs` passes. Unit tests: the same 24 known failures as 1.10.6, none new.
- Not checked: a real Windows till.
