# Customer collection plans and annotated receipts

Customer Edit on Sales now supports cash pending, bank/UPI pending and a collection note. These are an editable collection plan, not a new invoice, opening balance or payment. Actual customer dues still come from the existing books. Entering a 50,000/50,000 split does not create another 100,000 of debt. Updates retain before/after values in audit and reject stale versions supplied by the editor.

Invoice receipts accept a note, received-by person/account and transaction reference. Choose the actual payment method independently of the pending portion being settled: UPI can settle a cash-pending portion. Selecting a pending portion reduces it atomically with the receipt; leaving allocation blank preserves the plan. Allocation exceeding that portion is rejected without posting money. Retrying a successful receipt does not reduce it twice.

Receipt details appear in party report transaction details, Excel exports and the books voucher memo. Received-by is descriptive text; it does not create a separate person's bank account or reconciliation ledger. Any person/account can be named.

Arbitrary openings and invoice-free settlements are implemented separately in [dated opening balances](opening-balances.md). Posted receipt amounts/methods remain immutable. Collection plans are current snapshots, not historical balances.

Migration: `20261009120000_collection_details` adds fields only. On code rollback keep the added columns and data; do not reverse the migration or delete receipts.

API fields: `PATCH /api/v1/customers/:id` accepts `pendingCash`, `pendingBank`, `collectionNote`, `baseVersion`; `POST /api/v1/invoices/:id/payments` additionally accepts `note`, `receivedBy`, `reference`, `pendingBucket` (`cash` or `bank`, omitted for no allocation). Existing permissions and invoice overpayment checks apply.

Local verification: API 183/183, API and web builds/typechecks passed. Browser tests use mocked APIs; financial lifecycle tests use isolated PostgreSQL. Deployment evidence belongs in the release handoff.
