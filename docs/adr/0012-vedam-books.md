# ADR 0012 — Vedam Books is the factory ledger

## Status

Accepted. 2026-09-12.

## Context

Khatabook held party balances. Tally holds group / sister-plant settlements. StoneOS already owns yard stock, invoices, payments, and expenses. Cloning Tally Prime or keeping a second live AR book would split the factory.

## Decision

StoneOS posts one balanced voucher (integer paise) for each invoice, collection, credit note, and expense. Chart of accounts is system-seeded per factory. Khatabook customer-list is a one-time opening import as of 2026-09-12 (owner/manager only). Party statements replace the Khatabook UI. Supervisor intake proposes rokad/DPR drafts; a different human confirms. Cash drawer lock stops further cash vouchers that operational day. Pack moves slabs to the PACKING location. GST is split on the same sales/CN vouchers (18% inclusive); GSTR is filed outside. Tally XML stays an archive log (`writesInventory: false`). Muster/payroll is not in this release.

## Consequences

- Isolation stays application `WHERE factoryId = session.factoryId` (ADR 0005).
- Opening import is not a nightly sync and does not mint INV numbers from debit narration.
- “Cash 97070” / “Vipul Cash 108162” in Khatabook details is narration, not a payment.
- A bot may propose intake as supervisor; it must not confirm its own draft.
- Interfactory AR/AP stays in Tally, not a second StoneOS ledger.
