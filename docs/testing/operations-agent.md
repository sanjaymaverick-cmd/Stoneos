# Granite operations testing agent

The agent models storekeeper, operator and supervisor work through the real StoneOS REST API. The owner records block expenses and paid factory supplies; the persisted accountant role is read-only. Supervisors record consumables, runtime and maintenance; operators work cutting and polishing. Setup verifies that operator consumable creation is forbidden. It does not start services, seed accounts, connect directly to a database, or choose a deployment target.

Entry point: `scripts/testing/operations-scenarios.mjs`. The supervising runner must explicitly authorize a synthetic test factory, check the authenticated factory ID against an allowlist, and preserve the existing owner company. The latest user instruction permits a separate synthetic factory in the Oracle database; this is not authorization to mix demo entries into the existing business. A local or SSH loopback endpoint by itself is insufficient isolation. Do not erase the test factory without a later explicit instruction.

## Runner interface

`buildYearPlan({startMonth:'2025-10',months:12,workingDays:22})` creates the twelve complete historical months through September 2026. Set `ctx.plan` to this plan before calling `setupOperations(ctx)` and then `runOperationsDay(ctx, day)` for every day in month order.

The context contains:

- `request(role,method,path,body,options?)`, returning `{status,ok,body}`. Paths already include `/api/v1`. The adapter authenticates the actual requested role, records HTTP evidence, throttles below service limits, and throws on unexpected status. It must not silently retry non-idempotent production writes.
- `runId`, a short unique synthetic run identifier.
- `report`, a mutable report object receiving `operationsAssumptions`.
- Optional `check(name,boolean,details)` for invariant evidence and `plan` for monthly supply quantities.

Setup places machine, supplier and consumable state in `ctx.operations`. The day result contains `slabIds`, full `slabs`, `blocks`, `blockIds`, `area`, `date`, `day`, `tons`, `damaged` and cutting/polishing machine IDs. The sales agent must use these actual returned slab IDs and dimensions; it must never fabricate stock or sell the same slab twice.

## Explicit scenario assumptions

These figures are test inputs, not validated operating advice or measured consumption standards:

| Input | Value |
|---|---|
| Production days per month | 22 dates, the first through the twenty-second |
| B21 good output | 4,400 sqft/day; 96,800 sqft/month |
| Raw blocks | Two 20-ton blocks each day |
| Good recovery | 110 sqft/ton exactly |
| Slabs | 55 good pieces/block, 8 × 5 feet, 18 mm |
| Damage | One extra saw-damaged piece/block; not a saleable slab |
| LPM flow | Grinding, resin, polishing of the same 110 pieces/day |
| Machine runtime | 20 hours with 30 minutes downtime/day, two shifts |
| Raw price / royalty / transport | ₹10,000 / ₹400 / ₹700 per ton |
| Sales targets passed to commercial agent | 80,000, 88,000, 96,000 sqft, rotating monthly |

The two cutting sessions record ten hours each: these are consecutive halves of one machine day. Machine-runtime records contain the single twenty-hour daily total. No additional runtime is invented for each LPM process because the app has no per-pass runtime input.

| Consumable | Unit | Assumed usage per 1,000 sqft | Demo price per unit |
|---|---|---:|---:|
| Epoxy resin | litre | 12 | ₹650 |
| LPM abrasives | piece | 8 | ₹180 |
| Diamond segments | piece | 2 | ₹850 |
| Lubricating oil | litre | 1 | ₹320 |
| Grease cartridge | piece | 0.5 | ₹280 |
| Colour converter | litre | 0.75 | ₹950 |
| Saw blade | piece | 0.02 | ₹18,000 |
| Resin hardener | litre | 3 | ₹700 |
| Finishing pads | piece | 1 | ₹450 |

Monthly stock receipts buy projected usage plus a ten-percent buffer. Physical piece purchases round up; usage of fractional pieces represents amortized tool wear, explicitly stated in movement notes. Only `piece` and `litre` are supported by the current API. Grease cartridges avoid falsely recording kilograms as litres. Factory staff must replace these defaults with actual pack sizes, densities, process usage and supplier rates before operational planning.

## Workflows exercised

Create complete synthetic suppliers; receive all specified rough varieties across the year; record royalty and transport as net paid expenses allocated to each block; start cutting, log production, complete with saw damage; run grinding, resin and polishing; update machine runtime; receive and consume the nine supplies; monthly maintenance scheduling, rescheduling, alert reads and repeated completion. Raw receipts and initial consumable receipts replay the same operation reference to check that no duplicate stock appears.

Every day checks 4,400 sqft / 40 tons = 110 recovery, 55 good slabs and one damaged slab per block, and sellable stock only after polishing. Commercial payments, customer dues, supplier settlements, payroll, account reports and the rest of the product are the supervising runner's responsibility. This module alone is not proof that every StoneOS feature works.

## Known coverage limits to measure honestly

1. Consumable receipt/usage has quantity, date and reference but no linked vendor bill, rate, GST, payable, machine, block or production-session foreign key. A corresponding bank-paid expense records the financial spend separately. A credit consumables procurement lifecycle is therefore **partial**, even if both writes return success.
2. Raw-block purchase receives historical `occurredAt`, but the existing service omits that date when calling `BooksService.postPurchase`. Stock dates are historical; financial purchase vouchers can default to the current date. The runner must compare dated stock and journals and report this discrepancy rather than accepting misleading monthly GST figures.
3. The current derived DPR sums completed grinding, resin and polishing session lines into `slabsPolished`. Running all three processes can report 330 process passes for 110 polished pieces. Compare against distinct final-polishing output and classify the KPI discrepancy as a failure.
4. Cutting completion has no repeat-safe operation reference; a lost response must be reconciled against the recorded session before retrying. Polishing completion is likewise not a safe blind retry. Maintenance completion returns the already completed record and is explicitly checked.
5. Existing historic persisted roles map manager/admin to owner and inventory/sales to supervisor. New role provisioning is restricted. Real distinct account sessions must be tested and this permission behavior disclosed; token aliases are not separate agents.
6. No standalone waste-disposal endpoint exists in the inspected production controllers. Saw damage is recorded as counts and cost, not inventory rows. Do not invent waste stock to inflate coverage.
7. Cutting damage cost currently chooses `actualAmountPaid` before the purchase amount. Credit blocks received with zero payment can therefore record zero damage cost despite a positive net purchase value. The runner intentionally uses unpaid quarry receipts and must flag the missing damage valuation; making everything immediately paid would conceal the defect.

No production writes or UI proof have been executed by this module's author. Status becomes proven only from the supervising runner's recorded HTTP responses and invariants.
