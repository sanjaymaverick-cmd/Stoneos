# Handoff: independent architecture critic

**Audience:** a reviewer who did not build StoneOS and is not bound to defend it.
**Repo:** https://github.com/sanjaymaverick-cmd/Stoneos
**Workspace (author machine):** `D:\work Dir\stoneOS`
**Review date requested:** 2026-09-06
**Tip at handoff write-up:** `origin/main` after CEO/Copilot docs (verify SHA locally; do not trust this file’s memory of a hash).

You are asked to **criticise the architecture**, not to extend features. Say what would fail in a single-factory granite plant (Vedam Granites, RIICO Baggad) and what is cargo-culted from SaaS ERPs.

Do not treat a route or a page as proof. Classify each claim **proven / partial / asserted**.

---

## 1. Charter (what the system claims to be)

StoneOS is a clean-room TypeScript monorepo for **one granite factory’s operations ledger**: unique blocks and slabs, cutting and LPM, opening-count go-live, reservations, invoices, payments, expenses, Tally import, and an executive KPI board.

It is **not**: a multi-tenant SaaS product, a replacement GL, a CNC/nesting engine, or a grounded SQL chatbot.

Reference repos `ston3gpt` and `stoneos3` were audited and **not merged** (ADR 0001, `docs/reference-matrix.md`). Rules were reimplemented; files were not copied.

---

## 2. What to read first (in this order)

| Order | Path | Why |
|---|---|---|
| 1 | `CONTEXT.md` | Domain language. If the architecture fights this glossary, the architecture is wrong. |
| 2 | `docs/adr/0001` … `0011` | Binding decisions. Short on purpose. |
| 3 | `README.md` | Layout and local-first stance. |
| 4 | `apps/api/prisma/schema.prisma` | Actual data model. |
| 5 | `packages/contracts/src/roles.ts` | Who may touch what. |
| 6 | `packages/domain/src/*` | Serials, 07:00 day, recovery 105, CEO rules, snapshot Copilot. |
| 7 | `apps/api/src/common/session.guard.ts` + `current-user.ts` | How `factoryId` is bound. |
| 8 | `apps/api/prisma/migrations/20260905120000_init/migration.sql` | RLS ENABLE vs FORCE. |
| 9 | `apps/web/lib/api.ts` + `packages/sync-client` | Offline outbox and 409. |
| 10 | `docs/security-review.md` | Stated controls and residual risks. |
| 11 | `docs/production-readiness.md` | Evidence table — already stale vs CEO work. |
| 12 | `docs/runbooks/*` | Ops honesty. Backup runbook is a stub. |

Skip Electron/Android internals unless you are scoring “one UI, two shells” (ADR 0008).

---

## 3. Architecture in one page

```
Electron / Capacitor  →  Next 15 PWA (only UI)
                         ↓
              packages/sync-client (outbox, clientOpId)
                         ↓
              REST /api/v1  OpenAPI /api/docs
                         ↓
              NestJS API (tsx in prod image; explicit @Inject)
                         ↓
         domain + contracts + auth packages
                         ↓
         PostgreSQL 16 + Prisma + RLS ENABLE (not FORCE)
```

**Runtime today:** Docker Compose on a workstation. Cloud Terraform exists as a blueprint. Do not treat OCI/AWS modules as a deployed architecture.

**Identity:** username + scrypt password + opaque session (SHA-256 of token stored). No Clerk, no public signup, no JWT.

**Tenancy:** `factoryId` TEXT from session only, plus RLS on `app.current_factory_id`. Dual isolation is mandatory (ADR 0005).

**Idempotency:** `(factoryId, clientOpId)`. Money and stock: no last-write-wins; version mismatch → 409.

---

## 4. Invariants the critic should try to break

1. A client cannot choose another factory by body, query, or header.
2. Manager cannot grant or revoke owner.
3. Owner cannot strip their own owner role.
4. Damaged pieces never become `slab` rows.
5. Recovery uses sale-time sqft / parent tons, never saw dimensions; benchmark 105.
6. Damaged cost uses raw-block cost, not finished price.
7. Daily production totals cannot be typed as free-floating aggregates; they derive from sessions spanning 07:00 days.
8. Opening approval requires a **different** user than the counter; only then `operatingStatus = LIVE`.
9. Invoice payment cannot overpay; retry with same `clientOpId` does not double-post.
10. Service worker must not cache API GETs.
11. CEO Copilot must not run SQL from a question string or call an external model.
12. Operator / sales / inventory / supervisor must 403 on `GET /api/v1/reports/ceo` and `POST /api/v1/reports/ceo/ask`.

If any of these are only true in comments, say so.

---

## 5. Known tensions (do not discover these and stop)

Call them out if they are worse than stated; do not spend the review only restating them.

| Tension | Why it matters |
|---|---|
| RLS ENABLE not FORCE | Table owner role can bypass RLS. Authors avoided FORCE because managed Postgres often lacks BYPASSRLS. Isolation then rests on application filters. |
| Admin is in `CEO_ROLES` | Admin cannot manage people but can see rupee KPIs and Copilot. Systems role with commercial sight. |
| Sales is in `PAYMENT_ROLES` but not `CEO_ROLES` | Can post collections; cannot ask Copilot about AR. |
| CEO MTD uses calendar month | Shop floor uses operational day 07:00. Two clocks on one dashboard. |
| ADR 0010 says “no Copilot”; ADR 0011 adds snapshot Copilot | 0011 wins for `/dashboard` ask; 0009 still bans external LLM and ad-hoc SQL. Docs disagree in tone. |
| Snapshot Copilot is keyword routing | Product language says “AI analytics”. Critic should say whether that naming is misleading. |
| In-memory rate limits | 10/min login, 120/min anon, 600/min authed — per process. Multi-instance is unprotected. |
| Electron/Capacitor load a remote origin | Trust boundary is that origin, not the OS wrapper. |
| `apiFetch` queues **all** offline non-GET | `POST /reports/ceo/ask` is a read shaped as a write. Outbox pollution. |
| CEO work landed 2026-09-06 | `npm test` table still 30/0 from 2026-09-05. `/ceo` HTTP and operator 403 **not recorded** on smoke. |
| Backup runbook is a stub | No timed restore rehearsal. |
| Terraform apply forbidden | Dual-cloud ADR describes a future, not a running control plane. |

---

## 6. Questions we want answered

Answer in writing. “Looks fine” is not an answer.

### Fitness

- Is a single Nest monolith + Prisma + one Next PWA the right shape for a 20–40 person factory that also wants a tablet on the saw and an owner phone?
- What would you delete before go-live (Android shell, Electron, Terraform, Tally, Copilot UI, quotations)?
- Does opening-count → LIVE as a single transaction match how this plant actually starts books?

### Isolation and auth

- Is session-bound `factoryId` + RLS ENABLE enough, or is a restricted DB role mandatory before any second factory or Copilot expansion?
- Opaque hashed sessions vs JWT: did we pay the right cost for revoke-all?
- Is bootstrap-in-API-image a foot-gun in production images?

### Ledger

- Are damaged-as-count and sale-time recovery sufficient to stop the usual granite-ERP lies (stocking waste, inflating yield from gang-saw size)?
- Where does reservation / hold break if partial dispatch and customer-owned blocks coexist?
- Is Tally-as-GL with StoneOS as ops ledger a clean seam or a double-entry nightmare?

### Consistency

- Is `(factoryId, clientOpId)` + 409 enough for flaky shop Wi-Fi, or do we need an explicit conflict UI beyond HTTP?
- Should CEO asks be excluded from the outbox?

### Intelligence

- Is snapshot Copilot an acceptable v1 executive brief, or does the “AI” label create a liability if an owner acts on a keyword miss?
- What is the minimum safe path to a later SQL Copilot (RO role, validator, allow-list) if 0009 is ever lifted?

### Operability

- What is missing before this can survive a disk loss on the workstation?
- Rate limits, audit, and session revoke: enough for one site, or theatre?

---

## 7. Evidence the authors already have (do not inflate)

**Proven on or before 2026-09-05 (workstation record):**

- `npm test` 30 pass / 0 fail (pre-CEO files).
- API postgres workflows: idempotent goods receipt, vehicle expense factory check, manager cannot grant owner, cross-tenant block hidden, damaged slabs not stocked, opening SoD → LIVE, invoice retry / overpay reject.
- Smoke: health, bootstrap owner login `mustChangePassword`, PWA manifest, Prisma migrate on Postgres 16.
- Year-run (2026-09-06, pre-CEO-UI pull): 0 unexpected failures, 12 months, 201 payments.
- Security workflow script 10/10; Playwright module walk pass desktop+mobile (pages exist).
- NSIS and Android debug APK built (gitignored).
- OCI Terraform `validate` only.

**Partial / unproven after CEO land:**

- Domain/contracts tests for CEO brief and `CEO_ROLES` exist in tree; suite recount not re-run.
- `GET /api/v1/reports/ceo` and `POST /api/v1/reports/ceo/ask` not HTTP-proven on smoke.
- Operator 403 on those routes not HTTP-proven.
- Backup/restore not timed.
- Opening SoD on the *live smoke factory* may still be `SETUP`.

**Out of scope for this critic pass unless you insist:** cloud apply, CNC integration, 3D slab photos (Vedam Vision), clawSW Tally sync details.

---

## 8. How to run enough to criticise (optional)

```bash
git clone https://github.com/sanjaymaverick-cmd/Stoneos.git
cd Stoneos
# or pull in D:\work Dir\stoneOS

docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml up -d --build
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml exec -T api npx prisma migrate deploy --schema prisma/schema.prisma
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml exec -T api npx tsx src/bootstrap.ts
```

- Web `http://localhost:3000/login` — no signup.
- API `http://localhost:4000` — OpenAPI `/api/docs`.
- Fresh volume: `owner` / `ChangeMeNow!12` (`mustChangePassword: true`).
- If a year-run already mutated that volume: owner may be `YearRunOwner!12`. Confirm with `POST /api/v1/auth/login`.

Login 10/min/IP. Do not blast.

`terraform apply` is out of bounds.

---

## 9. Requested deliverable from the critic

A written review with four sections:

1. **Verdict** — fit / fit with conditions / unfit for a single-site granite factory in v1.
2. **Breaks** — invariants that fail in code or in operations, with file pointers.
3. **Cuts** — what to remove or freeze before the plant depends on this.
4. **Conditions** — the smallest set of proofs (tests, runbooks, role splits) before LIVE books.

Tone: adversarial and specific. No vendor comparison unless it shows a missing invariant (e.g. stocking waste as SKUs).

Authors will not treat praise as a ship gate. They will treat a failed invariant as a ship blocker.
