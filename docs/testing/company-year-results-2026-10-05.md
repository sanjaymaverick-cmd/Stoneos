# StoneOS company-year result — 5 October 2026

Completed on Oracle Cloud in **DRY RUN 12 MONTHS — 2026-10-05 — TEST COMPANY**, factory ID `5c183b6d-44b6-4e46-9744-3b705df6d38a`. Existing business data and owner credentials were fingerprinted before/after and remained unchanged. No test data was erased. The private simulation API was stopped; the public app is healthy and unchanged at deployed commit 8ed71d5.

## Measured results

| Measure | Result |
|---|---:|
| Period | October 2025–September 2026 |
| Working days | 264 (22 per month) |
| Raw blocks | 528 |
| Raw block weight | 10,560 tons |
| Daily good output | 4,400 sq ft |
| Manufactured output | 11,61,600 sq ft / 29,040 slabs |
| Actual recovery | 110 sq ft per ton |
| Gross manufactured-stock sales | 10,56,000 sq ft |
| Customer return | 40 sq ft (resold in a later month) |
| Remaining manufactured stock | 1,05,640 sq ft |
| Cash/bank receipts | ₹16,18,50,720 |
| Cash/bank payments | ₹4,08,91,300.04 |
| Ledger customer dues | ₹4,78,14,780 |
| Ledger supplier dues | ₹11,12,53,200 |
| Balanced vouchers | 2,229; zero unbalanced |
| Negative consumable balances | 0 |

Core manufacturing totals exclude the explicitly labeled supplementary lot/reversal/security/UI fixtures and 24 purchased countertops. Recovery uses good output; each raw block also records one saw-damaged piece. Quarry purchases intentionally remained on credit to exercise payables and reveal damage valuation. Four workers demonstrate payroll workflows; this is not a complete factory staffing/cost model. Consumption, supplier prices and tool-wear rates are synthetic assumptions, not operating standards. Counts are database-verified; cash/bank totals are journal debit/credit totals, not a real bank reconciliation.

## Monthly core activity

| Month | Production sq ft | Gross sales sq ft | Raw tons |
|---|---:|---:|---:|
| 2025-10 | 96,800 | 80,000 | 880 |
| 2025-11 | 96,800 | 88,000 | 880 |
| 2025-12 | 96,800 | 96,000 | 880 |
| 2026-01 | 96,800 | 80,000 | 880 |
| 2026-02 | 96,800 | 88,000 | 880 |
| 2026-03 | 96,800 | 96,000 | 880 |
| 2026-04 | 96,800 | 80,000 | 880 |
| 2026-05 | 96,800 | 88,000 | 880 |
| 2026-06 | 96,800 | 96,000 | 880 |
| 2026-07 | 96,800 | 80,000 | 880 |
| 2026-08 | 96,800 | 88,000 | 880 |
| 2026-09 | 96,800 | 96,000 | 880 |

## Workflow evidence

| Feature | Classification | Evidence / limitation |
|---|---|---|
| Raw and finished purchases | Proven | Real supplier/party details, GST, royalty/transport allocations, direct finished stock and partial payments. |
| Nine consumables | Proven stock; partial procurement | Epoxy, abrasives, diamond segments, oil, grease, colour converter, saw blades, hardener, finishing pads. Monthly receipts, daily usage, history, idempotency and overdraw tested. Expenses and stock receipts are separate records; no integrated consumable purchase/AP bill. |
| Cutting and LPM | Proven API; partial UI | 528 cuts; 264 daily grinding→resin→polishing cycles. Good recovery110. UI lacks complete dimensions/date/process choices and practical batch entry. |
| Damage costing | Failed | All528 unpaid-credit block cuts valued saw damage at0 despite positive purchase cost. |
| DPR polished KPI | Failed | One day's110 good pieces reported as330 polished pieces because allthree process passes are added. Slabs cut110 correctly. |
| Sales and fulfilment | Proven | Cash, invoiced, dealer credit, partial collections, separate bill/cash companion orders, packing, dispatch, return and credit note. Native single mixed bill/cash document not claimed. |
| Count-based lots | Proven | Cut, three stages, writeoff, overdraw, partial4/6dispatch, invoice retry and stock invariance. |
| Payments and dues | Proven journals; partial later AP settlement | Cash/bank/UPI/NEFT receipt modes, finished-purchase payments, supply/royalty/transport/expense payments, customer/supplier dues. All-dates party dues match books. No dedicated later quarry/supplier-credit payment workflow. |
| Return period reporting | Partial | September-ending report overstates customer dues by₹8,260 relative to books because simulated return note retains its database execution date. All-dates report agrees. Business dates for return notes need explicit review; normal present-day return timing is not claimed defective from this test. |
| Expense allocation and cost review | Proven | Paid expense+voucher+net block allocation; tagged royalty/transport, cost rates/confirmation and permissions. |
| Payroll/attendance | Proven | 4workers×22days×12months, half-days, overtime, separate proposer/approver, paid once on retry. |
| Maintenance and standards | Proven | Monthly inspection/reschedule/completion/retry and machine standards. |
| Books/GST/reporting | Proven books; partial statutory | Every month's trial balance balances. Normal input GST₹7,34,619.07; September has₹10,000 extra test-lot input. All12 totals reconcile. Mock e-invoice/eway, GSTR1 review, party reports and browser Excel downloads tested. No statutory filing/credit eligibility claim. |
| Intake, journal proposals, Tally, files | Proven tested paths | Independent confirm/reject, review-only journal, synthetic daybook import, attachment readback. Real historical Khata cutover import was not performed. |
| Opening stock | Partial | A LIVE company rejects re-opening. Positive SETUP-company count/approval lifecycle not tested; no factory state reset. |
| Role/security | Proven current controls; partial distinct hierarchy | Nine authenticated personas. 16 public security checks passed. Onlyowner/supervisor/operator are normally provisionable; legacy manager/admin→owner and inventory/sales→supervisor mappings disclosed. Accountant/auditor are read-only. |
| OpenAI | Partial | Unconfigured-provider boundary503 tested; live answers and extraction unverified without key. |
| Desktop/mobile UX | Partial / failures found | 132 route/persona/viewport checks; 18 measured mobile failures. Allfour targeted report-download/consumable-use workflows proved after correcting test selector assumptions. |

The main runner recorded10,653 requests and one failed KPI assertion. Five interruptions were historical14-day validation or checkpoint/date/separation-of-duties harness mistakes; they were corrected and recovered using saved actual evidence. They are retained in the raw report and are not five unresolved product errors. Supplementary checks:11 proven groups,1 partial. Individual HTTP successes establish only the paths exercised; they do not prove every possible combination.

## Date/safety boundaries

Normal public operational entry rejects timestamps over14days old. The user explicitly requested Oracle testing, so a private factory-restricted process used the same code/database with an async-scoped simulated clock; public validation remained unchanged. Manufactured slab creation dates match the recorded cut dates. Return-note database timestamps did not follow the test clock, exposing the report period limitation above. No server/database clock change or test-date rewrite was performed.

Synthetic owner login is `dry20261005_owner`. The generated password and fixture are saved privately in `var/company-year/fixture.json`; do not commit them. Use this test identity to inspect the test company; the existing owner still sees the original company. The data remains in Oracle until separately authorized cleanup scoped to this factory and dependents. Never truncate all tables or reuse previous cleanup authorization.

## Evidence and continuation

- `var/company-year/year-run-report.json`: actual request/check/month evidence.
- `database-verification.json`, `money-verification.json`, `dues-verification.json`: reconciliation.
- `extra-coverage.json`, `security-workflow-review.md`: supplementary API/security proof.
- `ui-ux/results.json`, screenshots and downloadedXLSX files: browser evidence.
- [UI/UX improvement backlog](ui-ux-improvements-2026-10-05.md).
- [Reusable testing agents](company-year-testing.md); source scenarios under `scripts/testing/`.

All files are saved in `D:\work Dir\stoneOS`. Offsite backups remain deferred. Fixes are listed for review; this test run did not change or redeploy product code.
