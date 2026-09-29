# Architecture critic review — StoneOS

**Reviewed:** `origin/main` @ `eb4d8bc` (2026-09-18), not the `d122d70` named in the handoff.
**Method:** full read of `apps/api/src`, `packages/*/src`, `apps/web/lib`, `apps/web/public/sw.js`,
Prisma schema + all 8 migrations, ADRs 0001–0011, `docs/security-review.md`,
`docs/production-readiness.md`, `docs/runbooks/backup-restore.md`. One executable proof
(`factoryRecovery`, 2,000,000 random yards). No stack was run; every claim below is tagged.

**Tags:** **proven** = read in code or executed. **partial** = mechanism read, blast radius
not measured. **asserted** = judgement, argued but not demonstrated.

---

## 0. Two corrections to the brief before the review starts

**The handoff is stale by twelve days and roughly 40% of the API.** (proven)
It names `d122d70`; `main` is `eb4d8bc`. Since it was written the repo gained a full
double-entry books spine (`ledger`, `party`, `voucher`, `voucher_line`), a cash drawer,
Khatabook import, a rokad/DPR intake pipeline, GST/e-invoice/e-way, and muster/payroll —
19 new tables across 4 migrations. The brief's "read first" table lists none of them and its
12 invariants cover none of them. **The most dangerous code in this repo is code the brief
does not mention.** Five of the nine Breaks below are in it.

**The brief understates its own evidence in one place and overstates it in another.** (proven)
- Understates: `production-readiness.md` records `/reports/ceo` operator 403 / owner 200 /
  auditor 200 on smoke (`var/week-one-smoke.json`), and CI run #54 has a `restore-fresh-runner`
  job that restores the dump on a clean machine. The brief calls both unproven.
- Overstates: the brief lists "RLS ENABLE not FORCE" as a *tension*. It is not a tension.
  It is a control that does not exist (Break 1).

---

## 1. Verdict

**Fit with conditions — but not the conditions the brief anticipates.**

The bones are right for a 20–40 person single-site plant. A Nest monolith + Prisma + one
Next PWA is correct here; the brief's own question ("is a monolith the right shape") is the
least interesting question about this codebase. Deny-by-default `@Roles` that throws on a
missing annotation, `(factoryId, clientOpId)` idempotency on every money write, a `SELECT …
FOR UPDATE` **plus** a `payment_cannot_exceed_invoice` database trigger, balanced-voucher
enforcement in `assertVoucherLines`, and atomic gapless document numbering via an upsert —
this is better engineering discipline than most ERPs sold into this segment. (proven)

What blocks LIVE books is not shape. It is that **three of the system's headline truth
claims are false in code**, and the plant would act on all three:

1. The recovery KPI — the single number this product exists to make honest — is
   mathematically incapable of reporting under-recovery.
2. Tenant isolation's second layer does not run at all.
3. An operator can post customer payments and factory expenses.

None of these is a design trade-off. All three are bugs with small fixes. That is why the
verdict is "with conditions" and not "unfit" — but they are ship blockers, not backlog.

---

## 2. Breaks

### Break 1 — The recovery ratio cannot go below 105. The anti-fraud metric is the fraud. (proven, executed)

> **FIXED** on branch `claude/fix-recovery-ratio`. `factoryRecovery` now measures settled
> blocks at their full tonnage and excludes open ones outright. Regression cover added at
> both levels: `packages/domain/src/ceo-brief.test.ts` (7 cases incl. a property check) and
> an end-to-end case in `apps/api/test/integration.test.ts` that drives receive → cut →
> polish → sell and asserts the brief reads 50, not 105. Both fail against the old code.
> The record below is kept as found.


`packages/domain/src/ceo-brief.ts:95-106`:

```ts
const implied = r.soldSqft / RECOVERY_BENCHMARK_SQFT_PER_TON;
tons += Math.min(r.weightTons, implied);
```

For every block, `tons_i = min(w, sold_i/105) ≤ sold_i/105`, therefore
`sold_i / tons_i ≥ 105`. The aggregate is a weighted mean of per-block values each ≥ 105,
so the aggregate is ≥ 105 **for every possible input**.

Executed over 2,000,000 random yards: minimum value **104.99999999999996** — 105 to
floating-point noise.

| Yard | CEO headline | Truth |
|---|---:|---:|
| 20t block, 1000 sqft sold | **105.00** | 50.00 |
| 30t block, 300 sqft sold | **105.00** | 10.00 |
| 6 blocks, mixed, partially sold | **105.00** | 57.66 |

Consequences, all proven by reading `apps/api/src/modules/reports/reports.service.ts:100`:
- `CEO_RECOVERY_WARN_BELOW` / `RECOVERY_BELOW_BENCHMARK` is **unreachable** from
  `GET /api/v1/reports/ceo`. The `severity: "critical"` branch at `recoveryRatio < 90` is dead code.
- `ceoNarrative` tells the owner "Sale-time recovery is 105.0 sqft/ton against the 105 benchmark."
- Copilot answers "Why is recovery low?" with "Factory recovery is 105.0 sqft/ton. Benchmark
  is 105. At or above benchmark." — a fabricated reassurance on the one question the owner
  most needs answered honestly.
- The unit test that "proves" the rule (`ceo-brief.test.ts:24`) passes `recoveryRatio: 88`
  **directly into `ceoExceptions`**, bypassing `factoryRecovery` entirely. The one test that
  does call `factoryRecovery` uses `soldSqft: 210, weightTons: 2` — exactly 105. **The suite
  never exercises the under-105 path, which is why 62/62 green did not catch this.**

Worse: the honest number already exists twice in the same codebase.
`SalesService.recovery()` (`sales.service.ts:503-521`) and the `blockRecoveries` array in the
same CEO response both use the correct `recoveryRatio(sold, tons)`. So `/recovery-ratio`
shows the truth and `/dashboard` shows 105.00, from one request. **The owner-facing number is
the dishonest one.** (proven)

The comment on the function — *"Count only the fraction of block tons implied by sold sqft"* —
shows the intent was to avoid penalising blocks that are cut but not yet sold. That is a real
problem and a legitimate one. The fix is to exclude unsold blocks from the denominator, not
to cap the numerator's implied tonnage: report recovery over **fully-sold blocks only**, and
report "n blocks with unsold inventory excluded" alongside it.

### Break 2 — RLS is not a second layer. It is inert. (proven)

The brief frames this as "ENABLE not FORCE, so the owner role is exempt." The reality is
stronger:

```
$ grep -rn "withFactory\|current_factory_id" --include=*.ts --include=*.sql .
apps/api/prisma/migrations/20260905120000_init/migration.sql:895:  CREATE POLICY ...
apps/api/prisma/migrations/20260905131500_customer_return_factory/migration.sql:8: ...
apps/api/src/common/prisma.service.ts:14:  async withFactory<T>(...)
apps/api/src/common/prisma.service.ts:16:    set_config('app.current_factory_id', ...)
```

**`withFactory` has zero call sites.** `app.current_factory_id` is never set on any request
path. So even if you switched `ENABLE` to `FORCE` tomorrow, every query in the application
would return zero rows. The policies are not a weakened second layer — they are an untested
configuration that has never been on the request path and would break the app if activated.

It is also narrower than it looks. The `DO` loop at `migration.sql:880-898` covers 26 tables
from the init migration. **26 more tables have no RLS at all**, including every child table
that carries money and every table added since:

`sales_line_item`, `quotation_line`, `packing_line`, `delivery_line`, `customer_return_line`,
`expense_allocation`, `opening_inventory_line`, `cutting_day_log`, `polishing_session_slab`,
`document_sequence`, `credit_note`, `ledger`, `party`, `voucher`, `voucher_line`,
`cash_drawer_day`, `khata_import_batch`, `imported_khata_line`, `intake_draft`, `gst_profile`,
`e_invoice`, `e_way_bill`, `worker`, `attendance`, `wage_sheet`, `wage_line`.

Note the structural reason, which is the part worth fixing: **`sales_line_item` and
`voucher_line` have no `factory_id` column at all.** They cannot be RLS-protected without a
schema change. Every rupee of line-level detail is outside the tenant model.

`production-readiness.md` already concedes this in a parenthetical — "Isolation is application
`WHERE` (ADR 0005)", "Dual RLS not claimed". But **ADR 0005 was never amended** and still
reads "Application-level filters and RLS are both required. Cross-tenant tests must fail
closed", and `security-review.md` still lists RLS under "Controls present in this rebuild".
A new engineer reads the ADR, not a parenthetical in a checklist. (proven)

For a single factory the application `WHERE` is genuinely sufficient — every service method I
read passes `factoryId` from `user.factoryId` and never from a body, and `assertFactorySlabs`
re-checks slab ownership. The break is the **documentation claiming a control that does not
run**, which is exactly what makes the eventual Copilot RO role unsafe to introduce.

### Break 3 — An operator can post customer payments and factory expenses. (proven)

Three files:

- `apps/api/src/modules/books/intake.controller.ts:36` —
  `POST /intake/drafts/:id/confirm` is `@Roles(...INTAKE_DRAFT_ROLES)`.
- `packages/contracts/src/roles.ts:61` —
  `INTAKE_DRAFT_ROLES = [owner, manager, supervisor, operator, accountant]`.
- `apps/api/src/modules/books/intake.service.ts:123,142` — `confirm()` calls
  `this.expenses.create(user, …)` and `this.sales.pay(user, invoice.id, …)` **at the service
  layer**, bypassing the controller guards on those routes.

`PAYMENT_ROLES` and `EXPENSE_DATA_ROLES` both exclude `operator`. So an operator who cannot
`POST /sales/invoices/:id/pay` directly can post the same payment by confirming a rokad CSV.
The deny-by-default guard is correct and well-tested; it is simply not on this path. The
two-person rule (`draft.proposedBy === user.id` → 403) still holds, so this needs two staff —
but the second can be an operator, and the cash amount is whatever the CSV says.

This is the reason to treat service-layer calls between modules as a first-class RBAC surface,
not just controllers.

### Break 4 — Rokad intake silently deletes duplicate cash rows. (proven)

`intake.service.ts:127`:

```ts
clientOpId: shaClientOpId([draft.clientOpId, "out", particulars, String(outgoing)]),
```

No row index. `Expense` has `@@unique([factoryId, idempotencyKey])`. So **two identical rows
in one rokad sheet — same particulars, same amount, same day — post as one expense.** A day
sheet with `Diesel, 500` twice records ₹500. Identical repeated cash-out lines are the normal
shape of a rokad, not an edge case. The `in` side has the same defect (line 146).

Two more in the same method:
- `parseCsv` (line 16-22) splits on bare commas with no quote handling. A particulars field
  containing a comma — routine in Hindi/English mixed rokad text — shifts every column right
  and the amount lands in the wrong field. (proven)
- Cash receipts are matched to an invoice by `findFirst({ customer: { name: party.name } },
  orderBy: { createdAt: "desc" })` — a **string join on customer name**, applied to the
  **newest** invoice, not the oldest open one (line 134-140). Wrong AR ageing by construction,
  and wrong ledger entirely if two customers share a name. (proven)

### Break 5 — `confirm()` is not a transaction, and its status flag is a dead conditional. (proven)

`confirm()` loops rows calling three services, each opening its own transaction. If row 7
throws — and `sales.pay` throws `BadRequestException("Payment exceeds invoice amount")`
whenever the auto-matched newest invoice is already settled — rows 1–6 are already committed,
the draft is still `proposed`, and the operator sees a 400.

And line 211:

```ts
status: mismatch.length ? "confirmed" : "confirmed",
```

Both branches are identical. Someone intended `partial` or `needs_review`. A draft that
recorded mismatches — "unallocated cash in — no open invoice", "block missing — no stock
created" — is marked exactly as clean as one that reconciled. Nothing surfaces `mismatch` as a
CEO exception. **Unreconciled cash disappears into a JSON column.**

### Break 6 — Partial dispatch silently no-ops. (proven)

`sales.service.ts:208`:

```ts
const clientOpId = extra?.clientOpId ?? `dispatch:${salesOrderId}`;
```

then line 210-213 replays the stored `syncOperation` on a hit. `CONTEXT.md` states *"Partial
dispatch is allowed."* The **second** partial dispatch of an order, sent without an explicit
`clientOpId`, matches the **first** dispatch's key, returns the first delivery with HTTP 200,
and dispatches nothing. The slabs stay in PACKING; the truck leaves; the system says delivered.

The brief asks "where does reservation/hold break if partial dispatch and customer-owned
blocks coexist?" — it breaks before you get to customer-owned blocks.

### Break 7 — Offline writes are destroyed on session expiry, silently. (proven)

`packages/sync-client/src/outbox.ts:180-182`:

```ts
} else if (response.status >= 400 && response.status < 500) {
  next.dead = true;
```

and `apps/web/lib/api.ts:98-103`: a 401 clears the token and redirects to `/login`.

Sequence: tablet loses the network → operator enters a shift of movements → they queue →
network returns after the 7-day session has expired (`SESSION_DAYS = 7`) → flush → every item
gets 401 → **every item is marked `dead`** → `flushOutbox` skips `dead` items forever → the
operator is bounced to the login screen. The work is gone and nothing says so. 401 and 403 are
transient authorisation states, not permanent client errors, and must not be terminal.

Two more in the same layer:
- `apiFetch` fires `flushQueuedWrites()` unawaited after **every** successful call (line
  111-113), with no concurrency guard and a `localStorage`-backed store with no locking. Two
  overlapping GETs flush the same item twice. Money paths survive on `clientOpId`; `pack()`,
  `returnSlabs()`, `startPolishing()` and `completeCutting()` **have no idempotency key** and
  will double-post. (proven mechanism, partial on real-world frequency)
- `returnSlabs` (`sales.service.ts:403`) takes no `clientOpId`, mints
  `idempotencyKey: credit:${ret.id}` from a **fresh uuid each call**, and takes no row lock.
  Two concurrent returns both read `salesStatus: "dispatched"` under READ COMMITTED, both
  pass, both issue a credit note. **AR understated by a full credit note.** Contrast `pay()`
  four methods above, which does take `FOR UPDATE`. (proven)

### Break 8 — The offline app cannot be read offline. (proven)

`apps/web/public/sw.js` correctly bypasses `/api/` (invariant 10 holds). But it holds
trivially: the fetch handler **never calls `cache.put`**. The only cached entry is
`/offline.html`, added at install. Go offline and every route resolves to the offline page.

So the outbox queues writes for a UI the operator cannot load. The PWA is offline-*tolerant*
for a tab already open, and offline-*useless* for one that isn't. That is a materially
different product from what ADR 0006 and the Android shell imply.

### Break 9 — GST is treated as inclusive, with no way to say otherwise. (proven)

`books/money.ts:31-37` hardcodes `GST_RATE = 0.18` and `gstSplitInclusive`, and
`books.service.ts:postInvoice` splits `Invoice.amount` into `SALES` net + `GST_OUTPUT`.
`Invoice.amount` is computed in `sales.service.ts:285` as `Σ quantitySqft × rate` — the rate
a salesperson typed. Nothing in the schema, the contracts, or the UI records whether that rate
is inclusive or exclusive of GST. `GstProfile` carries gstin/legalName/stateCode and **no rate
and no inclusive flag**.

Granite is quoted per sqft **plus** GST in ordinary trade. If Vedam quotes that way, every
invoice books revenue 15.25% low and GST output liability high, and GSTR-1 is filed from it.
There is also no CGST/SGST vs IGST split by place of supply, which `state_code` exists for and
nothing reads. (proven for the code; **asserted** that Vedam quotes ex-GST — confirm before
acting)

### Lesser, still real (all proven by reading)

- **`Invoice` has no invoice date.** Only `createdAt`. MTD invoiced is keyed on row-creation
  time while MTD collected is keyed on `payment.paidAt` (a real `@db.Date`). That is a third
  clock, on top of the two the brief names, and it is inside a single KPI pair. A backdated
  or imported invoice lands in the wrong GST month permanently.
- **`SESSION_SECRET` is validated at startup and never used.** `config.ts:12-18` fails the
  boot on a short or placeholder value; `createSessionToken` is `randomBytes(32)` and
  `hashSessionToken` is an unkeyed SHA-256. The crypto is fine (256-bit token, unkeyed SHA-256
  is not brute-forceable) — but `security-review.md` lists "refuses placeholder
  SESSION_SECRET" as a control over a variable with no effect.
- **`tokenVersion` is incremented in two places and read nowhere.** `AuthSession` has no such
  column; `SessionGuard` never compares. Revocation works (rows are deleted), but the field is
  cargo cult.
- **ADR 0003 rejects JWT because tokens "live as bearer secrets in browser storage."** The
  opaque token is stored in `localStorage` (`api.ts:16`). The decision was right — server-side
  revoke-all is worth it — but the stated reason is contradicted by the client.
- **`canAccessPath` is allow-by-default** (`routePolicy.ts:40`: `if (!route) return true`)
  while the API's `assertAllowedRoles` is deny-by-default. Any new page added without a
  `routes` entry is visible to every role. The asymmetry will bite exactly once.
- **`/dashboard` is listed for all nine roles** in `routePolicy.ts:15`. The API 403s
  correctly, so an operator sees a nav item for a board that errors.
- **`completeCutting` creates slabs one-by-one in a loop with no transaction timeout override**
  (`production.service.ts:165-194`), while `invoice()` and `pay()` both set `{ timeout:
  30_000 }` — added, per `production-readiness.md`, *after the year-run hit P2028 at Prisma's
  5s default*. A 50-slab block is 100 sequential round trips on the default 5s budget. The
  same failure is waiting in the same shape.
- **`startCutting` does not check block status.** After `completeCutting` sets
  `currentStatus: "consumed"`, a second session can be started on the same block; completing
  it regenerates identical `V101/50/01` serials and dies on `@@unique([factoryId, slabSerial])`
  with a raw Prisma error.
- **`completeCutting(totalSlabsCut: 0, finalGoodSlabCount: 0)` is accepted.** The block is
  marked `consumed`, no slabs are created, and `PRODUCTION_INPUT_ROLES` includes `operator`.
  A block can be made to vanish by one operator with no approval.
- **Unpolished-sale blocking is a location check, not a state check.**
  `sales.service.ts:113` tests `slab.location?.code === "UNPOLISHED_STOCK"`. `CONTEXT.md` says
  *"a slab that clears polishing is always sellable"*; the code implements the converse
  ("anything not in that one bin is sellable"), so a slab moved to HOLD, or with a null
  location from an opening snapshot, sells without ever being polished.
- **`logCuttingDay`'s 409 is advisory.** The version read (line 101) is outside the upsert
  (line 114), no lock. Two writers with the same `baseVersion` both pass; the second wins
  silently. Compare `pay()`, which locks. Invariant 9's conflict guarantee does not generalise.
- **`reverseMovement` detects prior reversals with `notes: { startsWith: "reverses:<id>" }`** —
  a semantic index encoded in a free-text column, unindexed, O(n) over all movements. It also
  reverses stock without touching the invoice, payment, or voucher: an inventory reversal
  desynchronises stock from AR with no compensating entry.
- **`S3CompatibleStorage.put` and `.get` throw unconditionally** (`packages/storage/src/index.ts:57-67`).
  Setting `STORAGE_DRIVER=s3` or `oci` produces an app where every upload 500s. ADR 0007's
  "object storage (local disk or S3-compatible)" is half-true. Every rokad/DPR/khata source
  document lives on one local disk with no implemented remote target.
- **`infra/compose/docker-compose.prod.yml:7` ships `POSTGRES_PASSWORD: stoneos_dev_only`** in
  a public repo, in the only production-shaped compose file.
- **`money.ts:40-42` hardcodes ₹1,25,61,248 of opening AR, ₹1,63,671 AP and 46 parties as
  source constants.** Opening balances are data, not code: they cannot be amended without a
  deploy, they are not auditable as ledger entries, and they publish the firm's receivables to
  anyone who opens the repo.
- **`Invoice`, `Payment`, `Expense` carry `Decimal(14,2)` rupees; `VoucherLine.debit/credit`
  carry `Int` minor units.** Two money representations, bridged by `rupeesToMinor` at each
  posting site. Nothing reconciles the two sides. A single `Math.round` disagreement is
  invisible until a trial balance is compared against the sales ledger by hand.
- **`SYSTEM_PROMPT` in `copilot.service.ts:11` is a 4-line LLM system prompt that is exported
  and never sent anywhere.** There is no model. Shipping a prompt for a model that does not
  exist is the clearest possible signal that the "AI" framing is decoration.

---

## 3. Answers to the questions asked

**Is the monolith the right shape?** Yes, and it is not close. One Nest app, one Postgres, one
PWA for 20–40 people is correct, and the modular boundaries (`modules/*` + `packages/domain`
holding the rules) are clean enough to split later if that ever becomes true. Do not
reconsider this. (asserted, but with high confidence)

**What to delete or freeze before go-live.** Freeze, in this order: **Terraform**
(`infra/terraform/*` — a blueprint that consumes a CI job and implies a control plane that
does not exist), **Android + Electron shells** (both wrap a PWA whose service worker caches
nothing — ship the PWA and let people "Add to Home Screen"), **Copilot UI and
`copilot.service.ts`** (Break 1 makes its answers actively harmful, and the dead
`SYSTEM_PROMPT` makes the framing indefensible), **quotations** (`Quotation`/`QuotationLine`
have a create path and no conversion-to-order path — a dead end), **Tally** (per readiness,
`writesInventory: false`; it is an archive log, not a seam). Keep GST and muster; they are
real plant needs, but see Conditions.

**Does opening-count → LIVE as one transaction match how a plant starts books?** Yes, and the
implementation is the best-engineered thing in the repo: line-level enterer tracking, a
different-user approval check (`inventory.service.ts:238-241`), a single `APPROVED` guard, and
the whole posting in one transaction with a 120s budget. Two gaps: `startOpeningCount` and
`submitOpening` are each two non-transactional writes, and `approveOpening` has no lock — two
concurrent approvals of disjoint snapshots both reach `LIVE`, saved only accidentally by
serial-uniqueness. (proven; contrived in practice)

**Is session `factoryId` + RLS ENABLE enough, or is a restricted role mandatory before a
second factory or Copilot?** For one factory, the application `WHERE` is enough today —
**proven** by reading every service method. For a second factory it is not, and not because of
RLS: `AppUser.username` and `AppUser.email` are **globally** `@unique`, not
`@@unique([factoryId, username])`. Two factories can never both have a `ramesh`, and
`users.service.ts:62-63` leaks cross-tenant existence with "Username is already taken". For
Copilot, a restricted role is **mandatory and currently impossible**: `sales_line_item` and
`voucher_line` have no `factory_id`, so no policy can be written over them.

**Opaque hashed sessions vs JWT — right cost for revoke-all?** Yes. Revoke deletes rows and
takes effect on the next request; `revoke` and `resetPassword` both `deleteMany` sessions in
the same transaction as the user update. That is worth more than stateless validation at this
scale. Fix the *rationale* in ADR 0003, not the decision.

**Is bootstrap-in-API-image a foot-gun?** No — `bootstrap_lock` plus "refuses to run if an
owner already exists" plus a ≥16-char `BOOTSTRAP_TOKEN` is a reasonable design. The foot-gun
is next door: `.env.example` ships `ChangeMeNow!12` and `docker-compose.prod.yml` ships the DB
password.

**Do damaged-as-count and sale-time recovery stop the usual granite lies?** Damaged-as-count:
**yes, proven.** `completeCutting` loops `1..finalGoodSlabCount` and stores `damagedSlabCount`
as an integer on the session; no damaged row can become a `slab`. `damagedCostAtRawBlock`
values it at raw cost. This is the invariant the system keeps best. Sale-time recovery: **no** —
see Break 1. And the DPR intake path lets one operator write off a block's value from a CSV
(`intake.service.ts:193`) with no approval beyond the two-person draft check.

**Where does reservation/hold break?** Before customer-owned blocks are reached. There is **no
reservation entity**: `createOrder` sets `status: "CONFIRMED"` and flips slabs to `reserved`
in the same call, so "a hold for cutting, polishing, or a customer" (CONTEXT.md) exists only
as a sales order. `OwnershipType` exists on `RawBlock` and **nothing reads it** — customer-owned
blocks are modelled and unimplemented. And partial dispatch no-ops (Break 6).

**Is Tally-as-GL a clean seam?** It is not a seam at all right now — per readiness, the import
is a log that writes no stock and no invoices. But the repo has since grown its **own** GL
(`ledger`/`voucher`/`voucher_line` with balanced-entry enforcement). **Decide which one is the
GL.** Running a real double-entry spine here *and* Tally as the GL is the double-entry
nightmare the question worries about, and the repo is currently drifting into it by accident.

**Is `(factoryId, clientOpId)` + 409 enough for flaky Wi-Fi?** The keys are — the 409 is not,
and there is a specific one-line bug. `sales.service.ts:340` checks `baseVersion` **before**
line 347 checks for an existing payment with that `clientOpId`, and every successful `pay()`
increments `invoice.version`. So the canonical flaky-Wi-Fi case — request succeeds, response
lost, client retries the same `clientOpId` with the same `baseVersion` — returns **409
VERSION_CONFLICT instead of the original receipt**. The money is right; the operator is told
there is a conflict that does not exist. **Swap the two checks.** (proven)

**Should CEO asks be excluded from the outbox?** Yes, and it is worse than pollution: `POST
/reports/ceo/ask` queued offline will, on flush, be replayed as a write — and with Break 7,
a 4xx marks it `dead` alongside real cash entries in the same queue. Exclude read-shaped POSTs
by path.

**Is snapshot Copilot acceptable as v1?** Not while Break 1 stands — it will tell an owner his
recovery is fine when it is 57. Beyond that, the routing is fragile in a way the "AI" label
makes dangerous: `TOPICS` is scanned with `.find`, first match wins, so "why did the gang saw
**block**?" routes to `inventory` (which precedes `maintenance`) and answers with slab counts.
Any question containing a topic word gets a confident declarative regardless of what was
actually asked. **Rename it.** "Factory brief" or "Rule-based summary" is accurate and costs
nothing. "AI CEO Dashboard" over keyword matching, with a dead `SYSTEM_PROMPT` in the source,
is the kind of claim that becomes a liability the first time an owner acts on it.

**Minimum safe path to a SQL Copilot if 0009 lifts?** In order, and the first two are
prerequisites the current schema blocks: (1) add `factory_id` to `sales_line_item`,
`voucher_line` and the other 24 unprotected tables; (2) enable RLS on all of them and make
`withFactory` the only way any request touches Prisma, proving it with a cross-tenant test
that fails closed; (3) only then create the RO role with `FORCE ROW LEVEL SECURITY`; (4)
allow-list + validator; (5) a hard statement timeout. Steps 1–2 are worth doing on their own
merits even if Copilot never ships.

**What is missing before this survives a disk loss?** Less than the brief thinks and more than
the checklist says. CI run #54 has a `restore-fresh-runner` job that restores the dump on a
clean runner — that is a real, automated, machine-independent restore proof, and the brief's
"backup runbook is a stub" is out of date. What is genuinely missing: (a) **file storage has
no backup at all** — `LocalDiskStorage` writes to one disk and the S3 driver throws, so every
rokad/DPR/khata scan is on one SSD; (b) no timing on a **full** restore, only row counts; (c)
`restore-second-machine.sh` still unticked on a physically different PC; (d) nothing verifies
a dump is restorable at the time it is taken.

**Rate limits, audit, session revoke — enough or theatre?** Session revoke is real. Audit is
**nearly** real and has one structural flaw: `AuditService.record` writes **outside** the
transaction of the thing it audits in `users.service`, `inventory.service` and
`production.service` (though `sales.service` correctly uses `tx.auditEvent.create`). A crash
between the mutation and the audit write loses the record, silently. Make it always `tx`.
Rate limits are the theatre: in-process `Map`s, correctly documented as such — but note
`login` has **no lockout at all**, only 10/min/IP, which is 14,400 attempts per day per IP
against passwords with a 12-character floor.

---

## 4. Cuts

Freeze or delete before the plant depends on this:

1. **Copilot UI + `POST /reports/ceo/ask` + `copilot.service.ts`.** Delete the dead
   `SYSTEM_PROMPT`. Rename the remaining brief to "Factory brief". Re-introduce Q&A later, if
   ever, once Break 1 is fixed.
2. **Terraform (both clouds).** Move to a branch. It burns a CI job and, per ADR 0007's own
   words, describes a future.
3. **Android + Electron shells.** Until the service worker actually caches the shell, both are
   wrappers around a page that shows `offline.html` when offline. Ship the PWA.
4. **Quotations.** Create path with no conversion to order. Dead weight in the schema and nav.
5. **Tally import** — or promote it to the GL and retire the voucher spine. Not both.
6. **`OwnershipType`** on `RawBlock` — modelled, never read. Either implement customer-owned
   blocks or drop the column before it acquires meaning by accident.
7. **`withFactory`** — delete it or wire it. A dead method named after the system's stated
   isolation mechanism is worse than no method.
8. **`tokenVersion`** — delete, or check it in `SessionGuard`.

---

## 5. Conditions — the smallest set of proofs before LIVE books

Ship blockers. Each has a test that would have caught it.

| # | Condition | Proof that closes it |
|---|---|---|
| C1 | ~~`factoryRecovery` reports truth.~~ **DONE** — settled blocks judged at full tonnage, open blocks excluded, basis reported alongside the figure. | ~~A unit test asserting `factoryRecovery` returns < 105.~~ Closed by 7 domain cases + 1 end-to-end case; verified failing against the old implementation (`actual: 105, expected: 50`). |
| C2 | Intake `confirm()` cannot exceed the confirmer's own role. | HTTP test: operator token → `POST /intake/drafts/:id/confirm` on a rokad with a cash-in row → **403**, and no `payment` row. |
| C3 | Rokad rows are keyed by row index. | Import a CSV with two identical `Diesel,500` rows → **two** expense rows. |
| C4 | `pay()` checks `clientOpId` before `baseVersion`. | Replay the same `clientOpId` + same `baseVersion` after success → **200 with the original payment**, not 409. |
| C5 | Outbox treats 401/403 as retryable, and surfaces dead items. | Unit test: `flushOutbox` on a 401 leaves `dead` false. UI shows a non-zero dead/conflict count. |
| C6 | Partial dispatch works. | Dispatch 2 of 4 slabs, then the other 2 without an explicit `clientOpId` → **two** deliveries, 4 slabs dispatched. |
| C7 | `returnSlabs` takes a `clientOpId` and a `FOR UPDATE` on the invoice. | Two concurrent returns of the same slabs → **one** credit note. |
| C8 | `completeCutting` gets `{ timeout: 30_000 }` and a `currentStatus !== "consumed"` guard; reject `totalSlabsCut === 0`. | Complete a 60-slab block on a loaded box. Start a second session on a consumed block → 400, not a P2002. |
| C9 | GST basis is explicit. Add `gstInclusive` to `GstProfile` (or per-invoice) and read `stateCode` for the CGST/SGST vs IGST split. | One invoice each way, reconciled by hand against a real Vedam invoice. |
| C10 | Invoice gets a real `invoiceDate` (`@db.Date`), and MTD uses it. | An invoice created on the 1st with `invoiceDate` in the prior month appears in the prior month's MTD. |
| C11 | Docs stop claiming controls that do not run. Amend **ADR 0005** to say isolation is application `WHERE`; drop RLS from `security-review.md` "Controls present"; drop `SESSION_SECRET` from it; correct **ADR 0003**'s JWT rationale. | A reader of `docs/adr/` alone reaches true conclusions. |
| C12 | Opening AR/AP move out of `money.ts` into an opening-balance voucher. | Trial balance reproduces ₹1,25,61,248 from ledger rows, not constants. Repo carries no receivables figures. |
| C13 | File storage is backed up. | The nightly dump includes `STORAGE_LOCAL_DIR`, and the restore drill checks a file back out. |
| C14 | `AuditService.record` always takes `tx`. | Kill the process between a mutation and its audit write; the mutation is absent too. |

**Not blockers, but do them in the same pass:** `canAccessPath` deny-by-default; remove
`/dashboard` from operator/inventory nav; move `postVoucher`'s ledger lookup out of the
per-voucher path; rotate `docker-compose.prod.yml`'s password to an env var.

---

## 6. What this review did not do

- Did not run the stack, the migrations, the integration suite, or Playwright. Every "proven"
  tag above means *read in source* or *executed as an extracted function*, never *observed
  over HTTP*.
- Did not review Electron/Capacitor internals, `khata-pdf.ts` parsing accuracy, the muster/
  payroll module in depth, `gst.service.ts` beyond the inclusive/exclusive question, or the
  Terraform modules.
- Did not audit dependencies. CI's Trivy job is green on `eb4d8bc`; that is a point-in-time
  claim, as `security-review.md` correctly says.
- The single strongest claim (Break 1) was verified by extracting `factoryRecovery` verbatim
  and running it over 2,000,000 generated yards. The rest rest on reading. Treat Break 1 as
  settled and the others as needing the test in the Conditions table.
