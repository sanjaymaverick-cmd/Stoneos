# Daily yard workflow reduction

The daily rail / phone tabs are Today, Yard, Cut, Sell and Money. People and Machines are under More; Team and Audit are owner Settings. Existing recovery links redirect to Today. Opening count, attachments, archives and sync have no primary navigation entry. No data migration or deployment is part of this change.

## Data and authorization

- Today reads unpaid amounts per invoice (net of payments and credits), rather than netting unrelated invoice totals. Money includes document-backed AR even for historical invoices without posted vouchers, and supplier opening credits plus unpaid receipts. These reads do not create or repair ledger rows.
- Recovery uses sale-time sqft of dispatched, unreturned slabs and the entire parent block tonnage. Blocks with stock or reservations are excluded. The benchmark remains 105 sqft/ton.
- Dispatch updates the order state. Historical delivery state is derived on read, preserving stored history.
- New accounts may be issued only as owner, supervisor or operator. Persisted admin/manager sessions map to owner; inventory/sales to supervisor. Accountant/auditor are restricted to read-only Money/Audit. Operator writes are limited to cutting, polishing and attendance. Supervisor cannot enter Settings, issue accounts, invoice or collect payments.
- Future maintenance cannot be completed in the UI or API. Financial rows dated in 2027 remain available; no purge or re-dating is performed.
- Receipt and order attachments reuse scoped paths in the existing file store. Target ownership is verified before upload. Existing archive imports remain compatible. There is no new schema or storage driver.

## Local verification

- API unit and disposable PostgreSQL integration suite: 98 passed.
- Web route/service-worker unit suite: 14 passed.
- Contracts: 9 passed; domain: 27 passed.
- API and web TypeScript checks pass.
- Next production build passes.
- Browser fixtures: 8 passed at 390px, 799px and desktop. Covers five tabs, four Today tiles, positive AR, waiting recovery, role restriction, Yard grouping, diagnostic/runtime removal, separated bilingual attendance and Sell state actions.
- Phone screenshot inspected for layout. Browser tests use fixtures; API workflow tests use a disposable local database, never the live server.

## Review boundary

Original D:\work Dir\stoneOS checkout remains untouched. Work is on codex/yard-five in an isolated copy based on origin/main. No live database, server configuration, deployment, merge or production login was used. Self-hosted IBM Plex Sans and Fraunces retain their OFL licenses.
