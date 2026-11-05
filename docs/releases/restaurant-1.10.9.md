# Restaurant POS 1.10.9

Asked by the owner: the kitchen did not know a ticket was a delivery. The courier slip already carried the customer, phone, address, the delivery note, the courier and how it is paid.

## Changed

- **The kitchen ticket of a delivery** now opens with `*** ÇATDIRILMA ***`, the customer's name and the delivery note ("Qeyd: …", wrapped, not cut). Dish notes print under the dish as before. The address and phone stay on the courier slip only. Hall tables print as before.

## Technical

- `ReceiptBuilder::kitchenTicket` reads `delivery_orders` for the order (`ReceiptBuilder.cpp`). No migration, schema 72. No API change.

## Checks

- `delivery_dispatch_test.cpp` `[1109]`: delivery header, name and the whole note on the ticket, no address; a hall table's ticket unchanged. Full native suite 394 cases.
- Real core under Wine (`receipts.preview`): the kitchen ticket and courier slip of a delivery with a note and a dish note, read as printed text.
- Not checked: a real printer and a real Windows till.
