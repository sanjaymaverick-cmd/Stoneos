# Architecture critic synthesis

**Sources:** two independent reviews of `main` @ `d122d70` (2026-09-06).
- Reviewer A: source + Postgres 16 RLS experiment + domain tests executed; API suite not run (Prisma engine CDN blocked).
- Reviewer B: source review only; concurrency inferred, not reproduced.

**Merged verdict:** **Unfit for LIVE books.** Fit as a single-factory pilot with paper fallback **after** the agreed blockers below. Shape (one Nest API, one Postgres, one PWA) is accepted by both. Do not split the monolith.

This file does not re-prove their code pointers. Treat each as **asserted-by-critics** until a fix PR adds an HTTP or concurrency test on the same commit.

---

## Agreed (both reviewers)

Ship-blockers. If A and B both named it, it is not a taste argument.

| ID | Break | Layer | Why LIVE fails |
|---|---|---|---|
| S1 | Concurrent payment overpay | `SalesService.pay` — read sum, insert, no `FOR UPDATE` / no check constraint | Two ₹600 clicks on ₹1,000 both pass. UI mints a **new** `clientOpId` per click, so idempotency does not save a double-tap. CEO then `Math.max(0, invoiced-collected)` hides overcollection. |
| S2 | Child rows not factory-checked | `createQuotation` / `pack` accept `slabId` with only a global FK | Cross-factory slab can land on your quote or packing list. |
| S3 | “Dual isolation” overstated | RLS ENABLE, table-owner exempt; `withFactory` unused; child tables lack `factory_id` | Isolation is application `where` only. Restricted RO role later would leak line tables and read nothing on parents. |
| S4 | Opening SoD checks the wrong person | Approve compares `enteredById` = who clicked Start | Owner starts; same person enters lines and approves. |
| S5 | Opening drops weight / cost / dimensions | Approve creates blocks/slabs without payload tons/cost | Recovery and damaged-cost KPIs exclude the opening yard. |
| S6 | Recovery counts the wrong square feet | Sums `orderLines` with no sold/delivered/invoiced filter | Reservations, DRAFT, CANCELLED inflate “sold sqft”. |
| S7 | Prod Compose volume not mounted | `docker-compose.prod.yml` declares `stoneos_pg_data` but postgres does not use it | `compose down` on the stack the runbooks tell you to run **deletes the books**. |
| S8 | No proven off-machine backup/restore | Runbook is commands only | One SSD failure ends the ledger. |

**Agreed cuts (freeze until S1–S8 closed):** Electron packaging, Android/Capacitor, Terraform/dual-cloud apply work, quotations (also removes one S2 hole), Copilot *chat* expansion. Keep PWA + core ops. Keep Tally only as a file log until vouchers exist.

**Agreed LIVE conditions:** lock invoice on pay; order-membership + transitions on dispatch/return; bind outbox to actor+factory; preserve opening attributes + real two-person approve; restricted DB role *or* honest ADR rewrite; restore drill on a second machine; HTTP role tests on the release commit.

---

## Reviewer A only (still treat as high until disproven)

A executed more. B did not contradict these.

| ID | Finding | Action |
|---|---|---|
| A1 | **No reversal / void / cancel / PATCH anywhere** | Blocking. Mistyped 150 slabs has no in-app remedy. |
| A2 | Operational day uses server-local `-7h`; container TZ unset → UTC vs IST | Wrong date 07:00–12:30 IST every morning. Set `TZ=Asia/Kolkata`; test with `Z` instants. |
| A3 | `derivedDpr` sums typed `slabsProducedCount`, not slab rows | Breaks CONTEXT “never typed aggregates”. |
| A4 | `completePolishing` ignores `processType`; grinding marks finished stock; can un-sell a sold slab | Gate on `POLISHING`; refuse `sold`. |
| A5 | Invoice number = `count()+1` race; no FY series; one invoice per order blocks partial invoice; returns have no credit note | Statutory + money. |
| A6 | Guard fail-open: no `@Roles` ⇒ allow | Deny-by-default; lock CSV to CEO/audit; escape CSV. |
| A7 | Copilot substring routing (`"are"` → AR, `"stone"` → ton) + no “I don’t know” | Keep brief; cut or harden chat. |
| A8 | `factoryRecovery` adds **full** block tons if any sqft sold | False criticals mid-dispatch. Prorate. |
| A9 | Outbox only if `navigator.onLine === false`; shop Wi-Fi fail does not queue; `nextRetryDelayMs` unused; 400s retry forever | Catch fetch failure; cap retries. |
| A10 | No 409 on stock/money despite ADR 0006 | Wire version checks or delete the story. |
| A11 | Commercial writes unaudited | Invoice/pay/dispatch/return/expense/Tally. |
| A12 | Movement row has no from/to/value/business date; 7 movement types have no emitter; `CUSTOMER_OWNED` unused | Ledger cannot reconstruct location history. |
| A13 | Tally is XML tag counting; files are write-only 100 KB | Rename or delete. |
| A14 | API image runs `npx tsx`; bootstrap in same image; `SESSION_SECRET` unused; `BOOTSTRAP_TOKEN` not compared; prod postgres no `restart` | Build `dist`; split bootstrap; rotate committed secrets. |
| A15 | `npm test` does not run `ceo-*.test.ts`; one of those tests is red (`/Vedam/` vs exception headline) | Fix globs; fix test. |
| A16 | CI ignores `security-check.mjs`, year-run, Playwright | Add HTTP suite to CI. |

## Reviewer B only

| ID | Finding | Action |
|---|---|---|
| B1 | Dispatch/return accept any factory slab; not on order lines; not idempotent; dispatch does not update order status on partial | Same family as S2. Enforce membership + status machine + stable `clientOpId`. |
| B2 | Shared-tablet outbox: one storage key, replay uses **current** token | Bind outbox items to `userId`+`factoryId`; refuse replay on mismatch. |
| B3 | Outbox `clientOpId` not injected into replayed body | Replay must send the stored key. |
| B4 | Reservation version bump without checking `baseVersion` | Same as A10. |

---

## Invariant scoreboard (handoff §4, after both reviews)

| # | Invariant | After merge |
|---|---|---|
| 1 | No client-chosen factory | **Broken** (S2, B1) |
| 2 | Manager cannot grant owner | **Proven** (unchallenged) |
| 3 | Owner cannot self-strip | **Proven** (unchallenged) |
| 4 | Damaged ≠ slab rows | **Proven** (unchallenged) |
| 5 | Recovery = sale sqft / tons @ 105 | **Partial** (S6, A8, S5) |
| 6 | Damaged cost at raw-block | **Partial** (S5 → ₹0 on opening) |
| 7 | Day totals derived not typed | **Asserted / broken in impl** (A2, A3) |
| 8 | Opening approve ≠ counter | **Partial** (S4) |
| 9 | No overpay; retry safe | **Partial** (S1 serial only) |
| 10 | SW no API GET cache | **Proven** (A) |
| 11 | Copilot no SQL / no external model | **Proven** (A) — still a product-liability chat |
| 12 | Non-CEO 403 on `/ceo*` | **Code-true, HTTP-unproven** |

Add to the handoff checklist: S1 concurrency, S2/B1 membership, S7 volume, A1 reversal, A6 fail-open, B2 tablet outbox.

---

## What to ignore or defer

- Copilot *naming* debate: both say the brief is fine and the chat is the risk. Relabel; do not spend a week on brand.
- Microservice split: both said no.
- Cloud apply / dual Terraform: freeze, do not argue vendors.
- Whether JWT would have been better: keep opaque sessions; rewrite ADR 0003 (token still lives in `localStorage`).

---

## This week (union of both “do first” lists)

1. Mount `stoneos_pg_data` on prod postgres; nightly `pg_dump` to a second device; schedule a restore drill.
2. `TZ=Asia/Kolkata` + operational-day tests with UTC instants.
3. One reason-coded reversal/void path so a mistype is not `psql`.
4. Deny-by-default `@Roles`; lock CSV; factory-check every `slabId`.
5. `SELECT FOR UPDATE` (or constraint) on pay; mint `clientOpId` once per form, not per click.
6. Fix test globs + red CEO test; put guard HTTP cases in CI.

Without 1, the pilot can lose the only copy of the books. Without 3–5, the pilot cannot correct or trust money.
