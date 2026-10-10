# Workflow audit — 10 October 2026

Scope: static read-only inspection of current repository, not a live posting test. No business records changed. Findings describe executable code paths; existing integration coverage does not establish that a normal staff member can discover and complete them. No private customer or transaction figures are included.

## Conclusion

The user's difficulty is structural. The app has several partially overlapping commercial systems. Choosing a screen changes the record type, funds account, stock effect, tax-report inclusion and correction options. Users currently need knowledge of the internal architecture to operate it safely.

## Screen to record map

| User task / screen | API and records | Ledger / stock / reports | Assessment |
|---|---|---|---|
| Sell individual slabs `/sales` | SalesOrder → Invoice → Payment; `/sales-orders`, `/invoices/:id/payments` | Invoice AR/tax, selected slab lifecycle; GSTR-1 invoices | Operational but separate from aggregate lot and historical sale flows |
| Sell lots `/lots/sell` | `/lots/sell`, `/lots/invoice`; order/lot allocation/invoice, optional cash sale | Stock allocation; invoice tax; independent cash sale posting | Stronger stock linkage, but different commercial entry from Books |
| Local sale `/books/trades` | TradeDocument(local_sale), TradeSettlement, vouchers | AR/SALES_UNBILLED, clearing for ancillary dues; no stock allocation | Bookkeeping without completed stock issue |
| Manual ledger sale `/books/ledger-sales` | Same TradeService, ledger_sale, or link existing audited voucher | AR/SALES/loading/GST; no invoice or stock issue | Review UI exists, but separate financial-only pipeline |
| Raw purchase `/books/trades` | TradeDocument(raw_purchase), raw blocks/movements, settlements | RAW_STOCK/AP/tax; royalty/transport immediately debit Cash | Multi-block credit entry; invoice interpretation and payment limitations |
| Receive block `/inventory` | `/inventory/raw-blocks`; block purchase fields and movements | Separate invoice/cash purchase posting functions | Another purchase entry pipeline with different payment model |
| Record invoice receipt `/sales` | `/invoices/:id/payments`, Payment | Method maps to a coarse BANK ledger | Cannot choose the same named funds accounts as TradeSettlement |
| Collect opening dues `/books/openings` | OpeningSettlement per approved opening line | Invoice-free receipt/payment; method mapped to coarse bank ledger | Valid separation from source invoices, but poor everyday discoverability |
| Pay/receive trade balance `/books/trades` | `/books/trades/:id/payments`, TradeSettlement | Named funds, creditor offset, vendor advance, recorded customer advance | Supports partial/mixed initial settlements, but bill-bound |
| Expenses `/expenses` (Money) | `/expenses`; expense records and postings | Cost/category ledger, cash/bank method | Separate from trade-specific commissions/collection deductions |
| Rokad `/books/rokad` | Read cash vouchers, lock drawer | CASH only, daily locking | Reconciliation screen, not a comprehensive money-entry hub |
| GST `/books/gst` | position from voucher heads; GSTR-1 from Invoice/CreditNote | Tax position includes ledger postings; return document list uses invoices | Different source populations require explicit reconciliation |
| Opening WIP/job stock `/books/openings` | OpeningBatch/lines → stock/lot/custody | Stage recorded; no machine session started | Useful cutover model but separate continuation requirements |

## Prioritized findings

### P1 — cash/bank/PhonePe identity depends on posting route

Evidence: `apps/api/src/modules/books/chart.ts:59` maps payment text to CASH, BANK_ICICI, BANK_AXIS, BANK_NEMA, BANK_SHREECHAND or BANK_OTHER. `books.service.ts:97` uses this for invoice payments; `opening-balances.service.ts:271` uses it for opening settlements. In contrast `trade.service.ts:61` hashes any typed account name into FUNDS_* and `trade.service.ts:57` lists only CASH/FUNDS_* balances.

Consequence: a customer collection into the same actual PhonePe account can appear in BANK_OTHER when entered against an invoice/opening, or in a named FUNDS_* account when entered against a trade. Named-account lists omit legacy BANK_* ledgers. Free text may create a new account through a typo. A note naming a recipient is not an account allocation.

Fix: one FundsAccount catalog with stable IDs used by every receipt/payment/expense/opening/transfer flow; migrate preserving voucher history and reconcile all source balances. Payment mode and account identity must be separate fields.

### P1 — bookkeeping sale does not complete inventory issue

Evidence: `trade.service.ts:159` makes every sale `pending_lot_allocation`; the controller exposes only GET/list/create/payments. `/books/trades` renders that pending status; there is no allocate endpoint in this service/controller. `/sales` and `/lots/sell` own independent stock workflows.

Consequence: the user can post revenue and clear customer dues while the sold stock remains available. There is no visible completion action in the financial sale screen. Avoid entering a second sale in another screen to issue the stock.

Fix: sale draft permits confirmed stock allocation or explicit allocation-pending state; the same sale later resolves lot allocation and posts COGS/issue once, without re-posting AR/revenue. Provide a queue and action for every pending item.

### P1 — GST ledger and return documents have different populations

Evidence: `gst.service.ts:209` position reads ledger tax heads; `gst.service.ts:258` GSTR-1 reads Invoice/CreditNote; `trade.service.ts:163` ledger sales post output GST without generating Invoice. Therefore a manual ledger sale's tax enters position but has no corresponding GSTR-1 invoice row.

Fix: visibly classify source-document entry vs issued invoice. A reconciliation queue must show every taxed ledger sale missing a reportable/validated document, with reviewed resolution. Never suggest that recorded GST means a return-ready invoice. Keep full economic value and source-document reconciliation transparent.

### P1 — daily commercial entry is restricted to historical-import roles

Evidence: `trade.controller.ts:19` create uses HISTORICAL_IMPORT_ROLES; `packages/contracts/src/roles.ts:26` is owner/manager only. The trade UI uses the same gate. Sales/accountant can settle but cannot create these normal local/purchase/ledger records. `/sales` additionally shows payment form only for owner (`sales/page.tsx:125`) despite broader PAYMENT_ROLES server permission.

Fix: task-specific normal sale/purchase/receipt permissions shared between UI and server; keep historical import and reviewer permissions distinct. Validate the chosen policy with owner, manager, sales, accountant and auditor.

### P1 — no reviewed correction workflow for TradeDocument/TradeSettlement

Evidence: `trade.controller.ts` has create/list/payments, no correction/reversal routes. Both financial screens can post but cannot correct date, party, discount, settlement account or amounts after posting. Existing sales-order returns/credit notes do not address TradeDocuments.

Consequence: resolving an apparently unpaid same-day advance or mistaken payment allocation requires exceptional assistance. Direct database edits must not be a routine remedy.

Fix: immutable original + reviewed correction/reversal and replacement. Show prior/current amounts and exact dues/account/stock effects. Pure metadata corrections should preserve journal amounts; financial corrections must make balanced, audited entries and update settlement-derived outstanding consistently.

### P2 — advance receipt creation is missing from the ordinary trade flow

Evidence: `trade.service.ts:98` supports applying an already recorded CUSTOMER_ADVANCES balance. Trade controller has no standalone advance-receipt endpoint, while ordinary payment endpoint requires a bill and rejects overpayment (`trade.service.ts:211`). Customer pendingCash/pendingBank is descriptive and does not create a receipt.

Fix: Receive money → select customer/account/date → allocate to bills or leave as customer advance; later sale applies advance. Same-day advance and delivery collection may be entered as two actual cash receipt lines, clearly labelled, without inventing a prior-period balance.

### P2 — local ancillary charges and discounts require manual ledger reasoning

Evidence: `/books/trades` asks agreed material value, additional non-material customer dues, non-material collection paid from cash, commission. `trade.service.ts:165` posts clearing liability, `:190` reduces it. No structured discount field; local line rate totals are not validated against materialAmount as ledger-sale line totals are (`:118`). No separate actual labor/transport paid breakdown or derived retained cash preview.

Fix: line subtotal → explicit sale discount → material net; optional customer-collected vendor charges, actual payout account/amount and difference explanation. Preview gross received, vendor payout, net funds, residual vendor liability/customer due. User preference to omit vendor-charge detail should be a clear policy that still reconciles recorded funds, not unexplained balancing fields.

### P2 — raw purchase assumes intrastate tax and cash landed costs

Evidence: `trade.service.ts:168` always splits purchase GST equally CGST/SGST; supplier state is hard-coded 08 at `:170`; raw block tax allocation does the same (`:178`). `:184` credits CASH for all royalty+transport. No GST head choice or vendor credit/bank payment for those costs in `/books/trades`. QuotedRate is API input but not entered by trade UI.

Fix: supplier/place/tax-head choices; multi-block weights/rate-derived total with explicit rounding; costs have vendor, paid/unpaid status and actual account. Capture source invoice reference/taxable/tax separately with a discrepancy review instead of assuming all supplier taxes are intrastate.

### P2 — date meaning differs across modules and requested shift boundary

Evidence: `packages/domain/src/operational-day.ts:1` and `daily-report.ts:170` define 07:00–07:00 IST; user-requested production period is 08:00–08:00. Trades use date-only UTC (`trade.service.ts:44`); inventory receive supplies IST midnight (`inventory/page.tsx:225`).

Fix: explicit business date vs occurrence timestamp vs entry timestamp, shared configurable factory day boundary. Late entry uses actual effective date and preserves recorded-at audit timestamp. Validate backdated stock transitions and cash-day locks; do not silently translate user measurements or repeat stated allowances.

### P2 — opening/WIP continuation is not one guided onboarding path

Evidence: opening UI represents rough/grinding/resin/polishing stage and expressly says it does not start a machine session (`books/openings/page.tsx:104`). Job custody is zero-value and separate from own stock (`:101`). These are sound distinctions but users must discover separate operational continuation flows.

Fix: after opening approval, show next actions per unfinished lot: continue grinding/polishing, finish, dispatch own material or deliver job custody; do not re-receive/revalue the same stock. Present effective stock date independently of later data-entry date.

## Proposed simple operating model

Primary actions: **Sell**, **Buy**, **Receive money**, **Pay money**, **Transfer money**. Books contains statements, corrections and reconciliations rather than alternative ways of recording the same sale.

Each sell/buy wizard: party → actual business date/reference → material lines/stock → charges/discount/tax/source document → money already received/paid with account IDs → review → one posting. Provide draft save and resume. Credit requires no invented payment; partial/mixed payments are repeatable rows. Finished action shows outstanding, affected account balances and stock state in plain language. Every record has a single detail screen with timeline, receipts, balances, stock allocation and reviewed correction.

Opening balances are a one-time onboarding task; historical document entry is a clearly separate mode of the same commercial model. Avoid forcing staff to choose database record types. Preserve existing records with explicit source links and no duplicate posting.

## Acceptance scenarios for implementation

1. Same-day cash advance + final cash + discount: two cash receipts, zero customer due; no September-opening inference and no duplicate advance receipt.
2. Material plus third-party charges collected and immediately paid: preview gross receipt, actual vendor payout, retained funds and any difference; revenue policy is explicit.
3. One customer payment splits cash and named PhonePe; all screens and statements show identical account balances.
4. Credit invoice partly paid to own account, partly direct supplier settlement, partly supplier advance: customer AR, creditor AP/advance and cash all reconcile once.
5. Standalone advance before sale, later allocation, excess left unallocated: party timeline and statements agree.
6. Multi-block credit purchase with explicit rounding, partial bank payment and cash landed costs: one payable; block costs reconcile to purchase and cost vouchers; IGST and CGST/SGST tested separately.
7. Previously posted sale missing stock allocation: resolve without another revenue/AR entry; issued stock no longer sellable.
8. Mistaken settlement account/amount or omitted advance: reviewed correction changes both document due and voucher balance; audit preserves original.
9. Opening debt paid without invoice: choose actual named funds account; history and outstanding reconcile with normal receipt screen.
10. Backdated production from approved unfinished opening stock: no double stock/value, correct effective day, preserved entry timestamp and user-defined shift window.
11. A taxed manual source entry is visibly pending tax-document reconciliation and never disappears silently between GST position and return preview.
12. Owner, sales, accountant and manager can complete authorized workflows; auditor can view but not post. Desktop/mobile reachability and feedback are tested against the actual application.

Implementation should start with shared money-account identity and settlement/correction model, then a unified sale/purchase experience and inventory/tax completion queues. UI rearrangement alone will not remove the bookkeeping ambiguity.
