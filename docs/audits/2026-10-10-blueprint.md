# StoneOS blueprint audit — 10 October 2026

Scope: read-only architecture, ADR, schema and implementation review. No operational records were changed, no deployment performed, and no live workflow success is claimed from this source review. Examples deliberately omit private business amounts and names.

## Conclusion

The balanced-voucher foundation is reusable. The product has accumulated several independently valid entry paths without a single operating model. Users must first understand the implementation (Sales, local trades, manual ledger sales, opening settlements) before choosing where to record an ordinary sale or receipt. A navigation rename cannot resolve this. Build one task-oriented commercial workspace over the existing services, then close the accounting and inventory reconciliation gaps behind it; do not replace the ledger wholesale.

## Prioritized findings

### P1 — Ordinary sales and receipts have three competing document workflows

Intent: ADR 0012 describes one factory ledger for invoices, collections and expenses. Implementation: Books exposes Local sales & raw purchases and Manual ledger sales alongside the separate Sales module (`apps/web/app/books/page.tsx:57`, `apps/web/app/sales/page.tsx:316`). Local trades explicitly filter out ledger sales (`apps/web/app/books/trades/page.tsx:18`). Manual ledger sales have a different payment selector restricted to that register (`apps/web/app/books/ledger-sales/page.tsx:45`), while opening dues have yet another settlement form (`apps/web/app/books/openings/page.tsx:125`). This is one general ledger but several operational settlement universes. A user cannot safely infer which screen holds a customer's debt.

Recommendation: one Sales list with document origin/type badges, one party balance view, and one Receive money action which discovers opening dues, invoices and trade documents. Keep existing source IDs and APIs behind adapters. Do not repost old entries merely to make them discoverable.

### P1 — Ledger GST and the GST-document report can diverge

Intent: ADR 0014 freezes tax on the same document and reports it by head. Manual ledger sale posts GST_OUTPUT heads (`apps/api/src/modules/books/trade.service.ts:164`) but explicitly generates no tax invoice (`apps/web/app/books/ledger-sales/page.tsx:32`). GSTR document rows query Invoice and CreditNote, not TradeDocument (`apps/api/src/modules/gst/gst.service.ts:267`). Accordingly ledger output tax can exist without a corresponding document in that report. Keeping source discrepancies visible is appropriate; silently treating a return export as complete is not.

Recommendation: a visible reconciliation queue for ledger sales without validated tax documents, with totals bridged to output-tax ledgers. Block a claim of filing completeness while exceptions exist. Distinguish record source figures, issue invoice, and correct invoice; do not collapse these into a supplied GST amount box.

### P1 — Raw-purchase register assumes a local supplier and splits every tax amount equally

Evidence: raw purchases always debit GST_INPUT_CGST and GST_INPUT_SGST (`apps/api/src/modules/books/trade.service.ts:168`); new supplier state defaults to 08 (`:170`), and block tax fields are similarly split (`:178`). Its form accepts a total GST amount but no head/place-of-supply (`apps/web/app/books/trades/page.tsx:40`). This works for the local reviewed cases but is not a general GST-purchase workflow.

Recommendation: select existing supplier, document supply state and tax treatment; reuse the existing tax policy rather than introduce another calculator. Permit supplied source amounts only as an explicitly reconciled historical/document-entry mode. Preserve previous frozen tax postings.

### P1 — Daily production blueprint contradicts the owner's declared operating day

Evidence: `packages/domain/src/operational-day.ts:2` hardcodes start hour 7; daily reports use that window (`apps/api/src/modules/reports/daily-report.service.ts:45`). The owner specified 08:00-to-08:00 for these production records. Timestamped night-shift activity between those cutoffs will be attributed to different days. Business-date entries anchored at 07:00 (`apps/api/src/modules/books/money.ts:20`) require care during a change.

Recommendation: explicit factory operation-day configuration, effective date and migration policy. Keep financial calendar date and operational shift date distinct. Test boundary events; never shift historical ledger dates automatically.

### P1 — Normal commercial entry inherits historical-import permissions

Evidence: TradeController create requires HISTORICAL_IMPORT_ROLES (`apps/api/src/modules/books/trade.controller.ts:18`), defined as owner and manager only (`packages/contracts/src/roles.ts:26`). Both normal bill forms use that restriction (`apps/web/app/books/trades/page.tsx:25`). The manual ledger workflow is now the recommended daily entry screen, yet the accountant and sales staff cannot post through it. Separate read/payment rights do not solve creation.

Recommendation: define commercial-entry permissions intentionally, separate historical linking/cutover approval from daily sales/purchase entry. Display action availability clearly; retain approval for exceptional historical or tax-discrepancy workflows.

### P1 — Historical sales permanently declare stock allocation pending in the available workflow

Evidence: every trade sale creates stockStatus pending_lot_allocation (`apps/api/src/modules/books/trade.service.ts:159`); the trade controller exposes create/list/payment only (`apps/api/src/modules/books/trade.controller.ts:11`). Documentation confirms lot allocation and COGS are incomplete (`docs/trade-register.md`, final operational paragraph). This intentional safety measure is preferable to invented stock, but no allocation command in this controller closes the loop.

Recommendation: explicit pending-stock queue, link sale lines to existing production/opening lots, and post one dispatch/COGS event with reversal protection. Show stock and margin as incomplete until allocation. Daily sales should choose lots by default, with a reviewed historical exception.

### P2 — Counterparty and funds identity depend on typed names

Evidence: TradeDocument stores partyName but no party FK (`apps/api/prisma/schema.prisma:272`); service recreates/locates parties by name (`apps/api/src/modules/books/trade.service.ts:139`, `:212`). Funds are silently upserted from normalized input strings (`:61–64`). UI uses a datalist rather than mandatory account selection (`apps/web/app/books/trades/page.tsx:28`). A spelling variant can create another funds ledger or counterparty, fragmenting a balance.

Recommendation: stable party/account IDs, searchable selection and explicit create-new confirmation; aliases for known names. Add nullable IDs first and resolve old rows without changing vouchers. Typed strings remain display snapshots, not identity.

### P2 — Advance receipt and advance application are not a single discoverable task

Evidence: settlement kind customer_advance consumes CUSTOMER_ADVANCES (`apps/api/src/modules/books/trade.service.ts:95–98`); it is labelled Apply recorded customer advance (`apps/web/app/books/trades/page.tsx:27`). That correctly applies an existing balance, but does not tell a clerk how to record a same-day deposit and later delivery collection. Opening settlements are a separate task. This explains why a paid-in-full slip can be left with the advance portion apparently outstanding when only the final collection is entered.

Recommendation: Receive money first records actual funds and optionally allocates to a sale; unallocated receipt becomes a party advance. A later sale can apply that receipt once. Same-day split receipts appear as two receipt events and zero due; no opening-balance prompt unless the receipt really predates cutover.

### P2 — Corrections and adjustments require technical interpretation

Evidence: local sale materialAmount is entered separately from quantity/rate (`apps/web/app/books/trades/page.tsx:38`, `:41`); only ledger_sale enforces computed lines (`apps/api/src/modules/books/trade.service.ts:116–117`). Non-material customer dues and cash collection adjustment are generic numerical fields (`apps/web/app/books/trades/page.tsx:39`). Existing bills are immutable; docs require reversal/replacement but the register exposes no such correction action.

Recommendation: calculate line totals for every sale, give discount/rounding their own fields, and distinguish own income, vendor pass-through and actual vendor payment. Show a review equation: customer total, receipts by account, payouts, retained funds and remaining due. Posted correction should create an audited reversal/replacement or adjustment with reason; do not silently edit vouchers.

## Smallest coherent redesign

1. Four everyday entry points: New sale, New purchase, Receive money, Pay money. Searchable Customers/Suppliers and a single cash/bank/UPI account picker. Books becomes statements, balances, closing and reconciliation rather than the place users must discover normal transactions.
2. Sale wizard: party/date/reference; material lines and lots; invoice/source tax treatment; discounts and classified charges; receipts now or credit; readable review; post. Advanced historical/source discrepancy features remain behind an explicit mode.
3. Purchase wizard: supplier/date/reference; blocks or consumables; frozen GST treatment; inward costs with payable-to and paid-from selection; payment now or credit; review; post.
4. Receipt/payment workspace operates across document origins, supports unallocated advances and allocations, and shows one party statement and one account balance result.
5. Reconciliation workspace: source-invoice discrepancies, pending stock allocation, missing receipt allocations and reversals. Every incomplete status has a next action and an owner.
6. Reuse postVoucher, idempotency, cash locks, factory isolation and existing origin models. Introduce a normalized read projection first; add explicit identities and allocation links additively. Do not migrate by reposting historical sales.

## Acceptance criteria

- Owner, permitted sales clerk and accountant can identify the right task without knowing storage model or invoice origin.
- A same-day advance plus final receipt settles one sale fully; each receipt retains date/account/note; retry does not duplicate either.
- Cash, PhonePe, bank and direct supplier settlement remain distinct; source plan does not count as actual receipt.
- Gross collection and vendor payouts reconcile to net retained cash without changing material revenue; discounts and rounding remain explicit.
- Local, GST and imported/source sales share one list and party statement, while validated tax documents and unreconciled sources remain distinguishable.
- Purchase GST can use the appropriate head; raw-block stock, supplier debt and inward costs post once.
- Existing vouchers, openings, IDs and balances remain unchanged when enabling the new workspace; old data is readable through adapters.
- An allocation-pending sale can be completed through UI without reposting revenue; stock and COGS occur once.
- Corrections, cancellation, advances, later receipts and overpayments are demonstrated through real local UI/API flows with deterministic financial assertions.
- Production day boundaries match the configured factory convention; calendar invoice/tax dates do not change.

Verification still required: end-to-end role runs, mobile walkthroughs and read-only live report reconciliation. Source evidence establishes the design gaps; it does not establish every live user's current permissions or every historical row's reconciliation state.
