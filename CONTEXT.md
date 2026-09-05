# StoneOS domain glossary

Factory-operations language. Implementation details do not belong here.

- **Factory** — a tenant. All operational records belong to exactly one factory.
- **Owner** — supreme authority for a factory. The only role that may create, modify, or revoke owner accounts. An owner cannot strip their own owner role.
- **Manager** — may issue, reset, disable, or delete staff credentials except owners.
- **Admin** — systems and configuration role. Cannot manage people and cannot touch owner accounts.
- **Supervisor** — operational data entry and approval. No user management, no historical imports.
- **Operator** — production and machine input only.
- **Inventory** — stock movements, locations, receipts.
- **Sales** — customers, quotations, reservations, dispatch, invoices.
- **Accountant** — expenses, payments, Tally, exports.
- **Auditor** — read-only commercial and inventory history.
- **Raw block** — purchased or opening-counted granite block. Serial unique within a factory.
- **Cutting session** — one block on a gang saw. May span multiple operational days.
- **Operational day** — 07:00 to 07:00. Daily production totals are derived from sessions, never typed as free-floating aggregates.
- **Slab** — a good piece after inspection. Serial `{blockSerial}/{totalCut}/{sequence}`. Damaged pieces are a count on the session, never inventory rows.
- **Polishing session** — an LPM batch. Grinding, optional resin, then polishing. A slab that clears polishing is always sellable.
- **Inventory movement** — append-only ledger event. Retries reuse an idempotency key.
- **Opening snapshot** — the physical count that starts the books. Approval posts receipts and sets the factory live in one transaction.
- **Reservation** — a hold for cutting, polishing, or a customer. Partial dispatch is allowed.
- **Recovery ratio** — sale-time square feet sold per ton of parent block. Benchmark is 105 sqft/ton. Production dimensions are not the source of truth.
