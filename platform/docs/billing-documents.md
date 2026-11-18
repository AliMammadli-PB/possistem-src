# Billing documents and electronic acceptance

Deployed to the API, owner portal and admin portal on 18 November 2026. No POS application update is needed.

## Downloads

Authenticated owner: `GET /customer/billing/orders/:id/document.pdf?kind=invoice|agreement|evidence`.
Superadmin: the same suffix under `/admin/billing/orders/:id`. Admin order/payment numbers open the document panel. Owner invoices offer PDF downloads directly.

Every download checks ownership or superadmin permission, uses `private, no-store`, and records `invoice.document.export` with the document data digest. Documents are not public files and contain no bank token, password, PIN, PAN or CVV. PDF generation uses bundled OFL Fira Sans fonts; amounts use AZN because the font does not contain the manat glyph.

The invoice contains the account, contact person, contact information, supplier tax number, order amount and period, Epoint transaction, masked card and RRN. Bank-page `card_name`, when provided, is validated bounded text and explicitly identified as user-entered, not bank-verified identity.

The agreement download is an **electronic acceptance record and archived terms**, not a fabricated signed contract. It includes the exact linked consent ID, accepted amount/version/time and any later withdrawal. Missing or mismatched consent is not inferred. Missing historical terms are not replaced by today's terms as evidence of past acceptance. The evidence packet combines the receipt, acceptance and whitelisted payment audit events. Its SHA-256 compares record data; it is not a digital signature.

## Identity preservation

Migration `0062_billing_document_identity.sql` captures buyer identity on every new billing order, including recurring and admin charges, using a database trigger. Later profile changes cannot rewrite the invoice identity. Existing orders are reconstructed from the current profile once, with the reconstruction time and source explicitly disclosed. The migration does not change balances, payment statuses, consent dates or paid periods.

Recurring orders retain the exact consent and terms version used to authorize their renewal. Email invoice details use the saved identity and archived seller details when available.

## Validation and rollout

- Billing integration suite: 50 initial passes and one test matcher failure (the database rejected the mutation, wrapped by Drizzle). The matcher was corrected; the focused document, ownership, immutable identity, missing evidence and export checks then passed.
- Separate PDF/gateway/email suite: 11 passed, including footer pagination, bounded declared names, HTML escaping and original notification behavior.
- Chromium invoice UI: 390, 768 and 1536 px; no horizontal overflow or page errors, working PDF downloads.
- Actual exported documents: embedded Azerbaijani characters, amount, Baku timestamps, transaction/RRN, acceptance, withdrawal, page count and absence of blank pages checked from extracted PDF text and rendered pages.

Production backup: `/opt/possistem-pos-control/backups/billing-documents-20261118`. This includes the pre-change database and API/portal assets. The dedicated PDFKit runtime is `/opt/possistem-pos-control/billing-pdf-runtime-20261118`, linked into the live API's node_modules. Existing bank integration dependencies are untouched.

For rollback, restore the saved API modules and previous portal distributions, then restart the API. Leave the additive columns and identity trigger in place so new snapshots are not lost; database restoration is only for a separately assessed recovery. Customer-specific exports remain outside Git in restricted storage.
