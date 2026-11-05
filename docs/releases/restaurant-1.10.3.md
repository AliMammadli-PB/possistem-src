# Restaurant POS 1.10.3

Pilot build, never on the update feed. Its download link sat on the site as "Sınaq buraxılışı". Everything in it reached customers through 1.10.4.

## Changed

- **Ready-made recipes inside recipes.** "Hazır resept" in the recipe editor; selling takes the raw materials of the parts, deleting the sale returns them. Up to 8 levels, no cycles.
- **Recipe search** no longer resizes the dialog.
- **Prepaid table deposit.** Taken on the payment screen, cash or card with the bank RRN, as the first payment of a table order. It covers the bill up to its amount. Bill 8, deposit 10: the guest pays 10, nothing more. Bill 15: 10 + 5. The table stays open after the deposit. Migration 069.
- **One list of documents.** Salary, income, courier remittances and cash transfers join "Ödəniş qaimələri" with view, edit and cancel where they apply. Migration 068 backfills salary links and old transfers.
- **Salary.** The "Qeyd" and "Tarixçə" buttons are gone from the staff row. One salary payment is one document. Cancelling it reverses the meals deducted with it.
- **Cancelling an expense** asks for the reason in its own dialog.
- **Couriers.** No creating a courier in "Kuryerə ver". The list shows open orders and debt separately. Couriers are off Partners.
- **Branches.** A renamed branch renames its local object and warehouse. Opening Kassalar no longer creates objects.
- **"Mallar"** is hidden on the sale screen while empty.
