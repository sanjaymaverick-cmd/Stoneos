# Independent third-party audit report — StoneOS

**Auditor stance:** independent; no prior involvement in building this product. Every claim below was checked against the repository, the automated test run, or a live process I started myself — not against ADRs, README text, or `docs/production-readiness.md` checkboxes, which are treated as allegations only.

---

## 1. Executive summary

**No — not on this exact commit, as shipped.**

Everything about StoneOS's money, stock, and segregation-of-duties logic that I could exercise (85 automated tests against a real Postgres, plus static code tracing) held up well and matches the vendor's claims in detail. But I found that **the API server as defined by its own production Dockerfile crashes on startup**, immediately, before it can accept a single HTTP request (§Findings F-1). Nothing in CI would have caught this: CI builds the Docker image but never runs it, and never boots the NestJS process at all in any form. I cannot certify a build "Yes" or "Yes with conditions" when I cannot prove the server it ships actually starts.

**Conditional path to Yes:** if the owner (a) reproduces or disproves F-1 by literally running `docker compose -f infra/compose/docker-compose.prod.yml up --build` and hitting `/health/live`, and (b) fixes the circular-module-import bug if confirmed, the remaining evidence in this report — real DB-level overpay trigger, real service-layer SoD checks, real atomic invoice numbering, 85/85 green tests, honest ADRs about RLS — supports "Yes with conditions," with the residual risks in §6 accepted explicitly by the owner.

---

## 2. Scope and SHA audited

- **Repo:** `sanjaymaverick-cmd/Stoneos`, working copy at `D:\work Dir\stoneOS`
- **Branch / SHA:** `main` @ `f03951377b2b4674bce7d63157725abe38713175` (commit date 2026-09-18 12:26:56 IST)
- **Auditor environment:** Windows 11, Node v24.19.0, npm 11.17.0, Docker Desktop client v29.7.2 present but **daemon not running** (`docker compose up` failed: `dockerDesktopLinuxEngine` pipe not found) — flagged as a blocker per rule 6, not papered over.
- Independent verification was done three ways: (1) the vendor's own `npm test` run to completion, unmodified; (2) a from-scratch Postgres + migrate + bootstrap + API-start cycle I built myself, outside Docker, using the exact `CMD` from `infra/docker/api.Dockerfile`; (3) static code tracing across three parallel reviews (architecture, money/GST/backup, RBAC/SoD).

---

## 3. Findings table

| ID | Severity | Area | Claim vs evidence | Recommendation |
|---|---|---|---|---|
| **F-1** | **Critical** | Boot / architecture | Claim (implicit, `docs/handoff.md`, `production-readiness.md`): the API boots via `npx tsx src/main.ts` and has been smoke-tested repeatedly. Evidence: running that *exact* command (same Node major version, same env shape as the Dockerfile) against a freshly migrated Postgres crashes immediately: `ReferenceError: Cannot access 'BooksModule' before initialization`, thrown from `sales.module.ts:7` importing `books.module.ts`, which itself imports `sales.module.ts` (via `IntakeModule`, `books.module.ts:5,22`). Reproduced twice, including a minimal isolated `require()` of `books.module.ts` alone. The cycle (`BooksModule` ⇄ `SalesModule`) has existed since commit `776fb3b` (2026-09-12) and was untouched by today's `f039513` revert. **CI never boots the process at all** — `.github/workflows/ci.yml`'s `images` job runs `docker build` but no `docker run`/health check exists anywhere in the pipeline; the `quality` job's "API build" step only runs `tsc` (type-check-and-emit), which doesn't execute module-load order and would not catch this. Docker Desktop's daemon was unavailable in this sandbox, so I could not additionally confirm inside the literal container — this is a plain Node/V8 circular-ES-module-import defect, not an OS-specific one, so I have no reason to expect a different result there, but the owner should confirm directly. | Owner: run `docker compose -f infra/compose/docker-compose.prod.yml up --build` and hit `/health/live` today, before trusting any other claim in the repo's docs. If it also crashes, break the `BooksModule`⇄`SalesModule` cycle (e.g. move `IntakeModule` out of `books.module.ts` into its own file, or use `forwardRef()`), then add a real CI step that starts the built app and curls `/health/ready` before any other claim of "smoke tested" is written down again. |
| F-2 | High | Data integrity / GST | Claim: GSTR-1 export buckets documents by IST month. Evidence: `GstService.gstr1` (`apps/api/src/modules/gst/gst.service.ts:147-153`) uses `Asia/Kolkata`-correct code elsewhere, but the GSTR-1 month window is `new Date(`${month}-01T01:30:00Z`)` through the same instant next month — i.e. the **operational-day boundary (07:00 IST)**, not the **calendar-month IST boundary (00:00 IST)**. A document created between 00:00–07:00 IST on the 1st of a month is filed under the *previous* month. This is a real legal-filing-period bug, not naive UTC, but still wrong. `Invoice`/`CreditNote` also have no dedicated `operationalDate` column the way `Voucher` does; the export filters raw `createdAt`. | Add an IST-calendar-month (00:00–00:00) boundary specifically for GSTR-1, independent of the 07:00 operational-day cutoff used elsewhere; add a boundary-crossing test (23:59 and 00:30 IST on month-end). |
| F-3 | Medium | Stock integrity | Claim (brief §1, `docs/handoff.md`): "Only POLISHING creates sellable stock." Evidence: `Slab.salesStatus` defaults to `"in_stock"` in the schema (`schema.prisma:419`) and `completeCutting()` (`production.service.ts:169-182`) never overrides it — a freshly cut, unpolished slab parked at `UNPOLISHED_STOCK` already carries `salesStatus: "in_stock"`. `SalesService.createOrder` (`sales.service.ts:103-118`) only excludes `sold`/`reserved`/`voided`/`dispatched` — it never checks location or a "polished" flag. Nothing in the code path stops an unpolished slab from being ordered, packed, invoiced, and dispatched today. No automated test covers ordering directly from `UNPOLISHED_STOCK`, which is why this passed 85/85 green. | Add a `readyForSale` gate tied to `FINISHED_STOCK` (or a distinct pre-sellable status set at cutting, flipped to `in_stock` only by `completePolishing`), plus a regression test that attempts to order a freshly-cut, unpolished slab and expects rejection. |
| F-4 | Medium | Secrets hygiene | Claim (brief §0.4/§5): don't commit owner passwords. Evidence: `docs/handoff.md` has committed real-looking bootstrap/live/staff passwords (`ChangeMeNow!12`, `YearRunOwner!12`, and a `YearRunXxx!12` pattern shared across 8 staff accounts) across at least 14 commits in git history, most recently touched by `f039513` today. These are local Docker-smoke-stack credentials, not GSTN/production secrets, and `.env` itself was never committed (verified via full-history path search) — so this is not a live-secrets leak, but it is a repeated, self-acknowledged violation of the brief's own rule, and the reused `YearRunXxx!12` password pattern across 8 accounts is a bad habit that will bite if ever pointed at anything real. | Stop recording real/live passwords in tracked docs even for local smoke stacks; reference "owner credential used, rotated after" as the brief itself suggests. Rotate the pattern if any of these accounts still exist on a reachable box. |
| F-5 | Low | Data integrity | Claim: S3/OCI storage is a supported switch. Evidence: `packages/storage/src/index.ts` correctly selects a backend from `STORAGE_DRIVER` with no hardcoded keys (confirmed via secrets grep), but `S3CompatibleStorage.put`/`get` (lines 48-58) are unimplemented stubs that `throw new Error(...)`. Local disk is the only backend that actually works today. | Either implement the S3/OCI driver before claiming it as a switch, or mark it explicitly experimental/unimplemented in the docs. |
| F-6 | Low | Opening-books SoD | Claim: opening approval requires a different user than the enterer, "including when the owner started the snapshot." Evidence: `approveOpening` (`inventory.service.ts:225-246`) checks per-line `enteredById` against the approver, but never checks `OpeningInventorySnapshot.enteredById` (the *starter*, schema.prisma:463). If the owner starts the snapshot but has someone else key in every line, the owner is not in the per-line `enterers` set and could approve their own snapshot start. The integration test `rejects the line enterer from approving opening, including owner-start` covers the case where the owner also entered lines, not the case where the owner only started it. | Add an explicit check that the snapshot's `enteredById`/starter is excluded from valid approvers, and a test for owner-starts-but-does-not-enter-lines. |
| F-7 | Info | Hardening | `LocalDiskStorage.get(key)` (`packages/storage/src/index.ts:26-31`) does a bare `path.join(root, key)` with no `..`-traversal check. Currently unreachable — `FilesController` exposes only `list`/`upload`, no read/download-by-key HTTP route exists anywhere in the API (grep confirmed) — so this is Not proven as a live vulnerability today, but it's unguarded, and the first person to add a download endpoint will silently reopen S9. | Add a traversal check to `LocalDiskStorage.get` now, before any download endpoint is added, rather than relying on "we never wired it up." |
| F-8 | Info | Dead code | `VoucherSource` enum retains orphaned `interfactory_invoice`/`interfactory_settle` values (schema.prisma) that Postgres can't drop and that are unused anywhere in `apps/api/src` — harmless residue from the sister-plant reverts, per the brief's own severity guide (docs drift / unused enum values = Info). | No action required; note only. |

---

## 4. Workflow matrix (brief §2.B)

Method note: workflows 1–13 below were exercised via the vendor's own Postgres-backed integration tests (real embedded Postgres, real service calls, **not** through NestJS's HTTP/guard layer — see caveat under S1–S3) plus independent static code tracing. I could not additionally drive them through a live HTTP client end-to-end because of F-1 (server does not boot) and Docker daemon unavailability.

| # | Workflow | Verdict | Evidence |
|---|---|---|---|
| 1 | No public signup; bootstrap creates one owner; second bootstrap no-ops | **Pass** | I ran this myself twice against a fresh DB: first bootstrap creates factory+owner in one transaction; second logs `"Bootstrap already completed; refusing to run again"` and exits 0, no partial state, no HTTP route exists for it at all. |
| 2 | Opening inventory SoD, incl. owner-started snapshot | **Partial** | Per-line enterer≠approver enforced server-side and tested (`inventory.service.ts:225-246`); gap: snapshot-starter identity isn't separately checked (F-6). |
| 3 | Pay: `SELECT FOR UPDATE`, 30s txn, overpay rejected in service + DB trigger, idempotent | **Pass** | `sales.service.ts:330` (`FOR UPDATE`), `:396` (30s/10s timeouts), service check (`:349`) **and** a real Postgres constraint trigger `payment_cannot_exceed_invoice()` (migration `20260906120000_books_integrity`) both fire in the test log (`ERROR: Payment exceeds invoice amount ... CONTEXT: PL/pgSQL function payment_cannot_exceed_invoice()`). `@@unique([factoryId, idempotencyKey])` backs the double-tap-is-one-row claim. |
| 4 | Khata import: supervisor 403; totals-lock-or-fail; re-import no-op; narration not minted as INV- | **Pass** | Role list excludes supervisor (`HISTORICAL_IMPORT_ROLES = [owner, manager]`), enforced by `SessionGuard`; `khata.service.ts:51-55` throws unless totals match locked constants exactly; batch-level + per-voucher `clientOpId` idempotency both present; `looksLikeCashNarrationSplit` only flags, never posts. Live PDF fixture tests pass. |
| 5 | Intake: proposer≠confirmer; DPR from slab rows only | **Pass** | `intake.service.ts:101-103` blocks self-confirm server-side; `derivedDpr.slabsCut` computed by counting real `Slab` rows in the operational-day window, CSV values only compared for a mismatch flag, never fed in. |
| 6 | Cash drawer lock blocks further cash vouchers that day | **Pass** | Single choke point in `postVoucher()` (`posting.ts:46-54`); every voucher-creating module (sales pay, khata, muster pay, expenses) routes through it — confirmed no other `tx.voucher.create` call site exists. |
| 7 | Muster: 6-day wage line, SoD, supervisor cannot pay | **Pass** | Wage calc from attendance status × daily rate; proposer≠confirmer check; `MUSTER_PAY_ROLES` excludes supervisor, enforced by both `@Roles` and an in-service check. |
| 8 | GST: missing GSTIN → 400; mock IRN; GSTR-1 includes INV-/CN-; no secrets | **Partial** | Mock IRN and combined INV-/CN- export confirmed in code and tests; GSTR-1 month-boundary bug (F-2) means the period assignment is not fully correct. No live GSTIN-validation HTTP call exercised (blocked by F-1). |
| 9 | Copilot propose-only, no self-confirm, no SQL, CEO dashboard rule-based | **Pass** | No LLM/SDK import anywhere in `apps/api/src`; copilot only writes `IntakeDraft` rows via the ORM; confirmation reuses the same proposer≠confirmer gate regardless of origin; CEO dashboard built from deterministic Prisma aggregates, not a model call. |
| 10 | Tally import: log only, no slabs/invoices/stock | **Pass** | `TallyService.importDaybook` writes only a `TallyImportBatch` row; no `Slab`/`Invoice`/movement create call in the file. `writesInventory: false` hardcoded in the parser. |
| 11 | Files tenant-scoped | **Partial / Not proven for reads** | `list()`/`upload()` are factory-scoped and namespaced; there is **no download/read-by-key HTTP endpoint in the entire API** to test cross-tenant reads against — the claim is untestable as the surface doesn't exist yet, and the underlying storage `get()` has no traversal guard if one is ever added (F-7). |
| — | Pack vs dispatch invariants | **Pass** | `pack()` never sets `dispatched`; `dispatch()` requires prior PACKING and rejects already-dispatched; reversal goes through one documented, guarded `reverseMovement()` function. |
| — | Damaged pieces = counts, only polishing sellable | **Partial** | Damaged-as-count confirmed (`CuttingSession.damagedSlabCount`); "only polishing creates sellable stock" is **not enforced in code** (F-3). |
| — | Sister-plant removal complete | **Pass** | Migration `20260913120000_drop_interfactory_trade` drops all interfactory tables; no live `FactoryLink`/dual-AR-AP/cross-factory-slab-copy code remains (grep clean); only harmless orphaned enum values remain (F-8). |

---

## 5. Security matrix (S1–S15)

| ID | Verdict | Evidence |
|---|---|---|
| S1 | **Not proven** | Blocked by F-1 (server doesn't boot) and Docker daemon unavailability. `SessionGuard` deny-by-default logic is unit-tested in isolation (`session.guard.test.ts`: rejects missing annotation, rejects operator on CEO routes) but those tests call the guard class directly, not through a live HTTP request — a real black-box "curl with no cookie" test could not be run. |
| S2 | **Partial** | Session is opaque/hashed by design and unit-tested (`@stoneos/auth` "hashes opaque tokens"). Login rate limit (10/min/IP) is configured via env (`AUTH_RATE_LIMIT_MAX`) but not exercised live (same blocker as S1). |
| S3 | **Pass (code)** | `SessionGuard` derives `factoryId` solely from the DB-backed session row; no controller reads `factoryId` from the request body anywhere (grep-confirmed by the RBAC review). |
| S4 | **Pass (test)** | Integration test "isolates raw blocks across factories" passes against real Postgres; this is application-`WHERE`-layer isolation only (see S15). |
| S5 | **Pass (code)** | `operator` absent from `USER_MANAGEMENT_ROLES`, `HISTORICAL_IMPORT_ROLES`, `SALES_DATA_ROLES` — enforced via `@Roles` + guard. Not exercised live. |
| S6 | **Pass (code)** | `auditor` absent from production/inventory/pay role lists — enforced via `@Roles` + guard. Not exercised live. |
| S7 | **Pass (code)** | `SessionGuard` globally blocks non-exempt writes while `mustChangePassword` is true — a request-level gate, not a UI banner. |
| S8 | **Pass** | Every raw query in `apps/api/src` uses Prisma tagged-template `$queryRaw`/`$executeRaw` with `${}` parameter binding (health check, `FOR UPDATE` lock, sequence upsert, `set_config`) — no string-concatenated SQL found. |
| S9 | **Not proven / N/A today** | No download-by-key HTTP endpoint exists to attack (F-7 notes the underlying storage function is unguarded for whenever one is added). |
| S10 | **Not proven** | Requires a live web app + browser; blocked by F-1 and Docker unavailability. |
| S11 | **Fail (scoped)** | `.env` never committed (full git-history path search clean). But `docs/handoff.md` has repeatedly committed local/dev-smoke passwords (F-4) — a direct violation of the brief's own rule, even though not a production-secret leak. |
| S12 | **Pass (code)** | No LLM SDK import anywhere in `apps/api/src`; propose/confirm split enforced identically regardless of proposer identity. |
| S13 | **Pass (code)** | `reverseMovement()` is the only function that reverts `salesStatus` from sold/dispatched/reserved; type-gated, double-reversal-guarded, and no other call site sets a sold slab back to `in_stock` outside the documented credit-note return flow. |
| S14 | **Pass** | `cloud-apply.yml` triggers only on `workflow_dispatch`; `scripts/cloud-apply.sh` hard-fails on any missing `AWS_*`/`OCI_*` secret via bash parameter-expansion guards (`: "${VAR:?required}"`), so missing secrets fail the job rather than skip-green. Typecheck/tests/builds are unqualified (non-`continue-on-error`) CI steps; the only `continue-on-error` is on the informational `npm audit` report step. |
| S15 | **Fail as a control (confirmed, matches the vendor's own ADR 0005 disclosure)** | RLS is `ENABLE`, not `FORCE` (migration comment says so explicitly); the table-owning app role is exempt regardless. Worse than the ADR states: `PrismaService.withFactory()` — the only code that would ever set `app.current_factory_id` — has **zero call sites** anywhere in `apps/api/src`. The RLS policy is inert, dead-code scaffolding today; isolation is 100% application-`WHERE`-clause dependent, with no second layer at all. Do not describe this as defense-in-depth in any customer-facing material. |

---

## 6. Residual risks the owner must accept

1. **F-1 must be resolved and re-verified live before anything else in this list matters.** Everything below assumes the server actually starts.
2. **Application-level tenant isolation only, no working RLS layer** (S15) — a bug in any single controller/service's `WHERE factoryId` clause is a direct cross-tenant leak with no second line of defense. Acceptable only if the team commits to code review discipline on every new query.
3. **GST is mock/IRN-simulated**; real GSTN filing happens outside StoneOS. GSTR-1 has a month-boundary bug (F-2) that must be fixed before the export is trusted for a real filing period.
4. **No proof of restore on a genuinely different physical machine** — only a same-CI-run "fresh runner" restore (different ephemeral container, same GitHub Actions network) and a same-workstation second-disk rehearsal exist. The `docs/production-readiness.md` checklist itself already marks this unticked; I confirm that's accurate.
5. **S3/OCI storage backend is unimplemented** (F-5, throws on use) — local disk is the only production-real option today despite being described as a switch.
6. **Copilot is currently disabled/deferred** — if an API key is ever set, the propose-only/no-self-confirm/no-SQL boundaries are enforced in code today, but this needs re-audit at the moment Copilot is actually turned on, since nothing in this review exercised it live.
7. **Khata cutover fixture data uses filler party names** for 36 of 46 parties in the test fixture (`docs/books-khata-cutover.md` says so itself); whether the *production* database has since had the real Vedam PDF import run is not verifiable from the repository — the owner must confirm this operationally, not assume it from a green test suite.

---

## 7. Out of scope / not tested

- Any live HTTP black-box testing (S1, S2 rate-limit, S10 XSS/CSRF, GST mock IRN over HTTP, Playwright role-nav/module-walk) — blocked by F-1 (server crash) and Docker Desktop's daemon being unavailable in this sandboxed environment. **Say so plainly rather than inventing a green result**, per the brief's own rule 6.
- Desktop (Electron) and Android (Capacitor) app builds/behavior — not exercised; static review only confirmed neither has a second write path to the database.
- `node .grok/skills/security-workflows/scripts/security-check.mjs` — not run, since it targets a live API and none was reachable.
- `scripts/restore-second-machine.sh` on an actual second physical machine — genuinely requires second hardware, not obtainable in this environment.
- `terraform apply` — correctly not run, per explicit non-goal.
- Full git-history secrets scan beyond `.env`/password-pattern searches — a targeted, not exhaustive, scan was done (found F-4, nothing beyond it in the patterns checked).

---

## 8. Appendix — commands run and key evidence paths

```bash
git rev-parse HEAD                    # f03951377b2b4674bce7d63157725abe38713175
npm run typecheck                     # exit 0, all 7 workspaces
npm test                              # exit 0, 85 pass / 0 fail across 7 workspaces
                                       #  (@stoneos/api 48, contracts 6, domain 17,
                                       #   storage 2, sync-client 5, web 4, auth 3)

# Independent live-boot attempt (outside Docker, Docker daemon unavailable):
node .../embedded-postgres start on 127.0.0.1:55433
npx prisma migrate deploy --schema prisma/schema.prisma      # 8/8 migrations, clean
npx tsx src/bootstrap.ts                                      # creates owner, once
npx tsx src/bootstrap.ts (again)                               # "already completed", no-op
npx tsx --tsconfig tsconfig.json src/main.ts                  # CRASHES (F-1)
node -e "require('tsx/cjs'); require('./src/modules/books/books.module.ts')"  # CRASHES (F-1, isolated repro)
```

Key files cited: `apps/api/src/modules/books/books.module.ts`, `apps/api/src/modules/sales/sales.module.ts`, `apps/api/src/modules/gst/gst.service.ts:147-153`, `apps/api/prisma/schema.prisma:419`, `apps/api/src/modules/sales/sales.service.ts:103-118,330,396`, `apps/api/src/modules/inventory/inventory.service.ts:225-246,367-448`, `apps/api/src/common/prisma.service.ts:14-19`, `apps/api/src/modules/books/posting.ts:39-54`, `packages/storage/src/index.ts:26-31,48-58`, `docs/handoff.md`, `docs/adr/0005-tenant-isolation.md`, `.github/workflows/ci.yml`, `.github/workflows/cloud-apply.yml`.

No credentials were printed above beyond what was already committed in `docs/handoff.md` (F-4); the audit's own bootstrap owner password (`AuditPass!12`) was generated fresh for this session and exists only in a throwaway, since-deleted local Postgres instance — it was never committed and the instance has been stopped and its data directory left in the session scratchpad, not the repository.
