# Independent third-party audit brief — StoneOS

**Use this document as the full prompt / statement of work for an auditor, review firm, or independent technical reviewer.** Do not rely on the vendor’s verbal claims. Prove or disprove every finding from the repository, running system, and evidence files.

---

## 0. Independence and rules of engagement

You are an **independent** auditor. You did not build this product. You do not work for the implementer.

1. Treat every checklist box, ADR, and README as **allegation**, not proof.
2. Classify each area: **Pass / Partial / Fail / Not proven**. “A page exists” is not Pass.
3. Do not `terraform apply`. Do not enable live GSTN / IRP / LLM secrets unless the owner provides a dedicated sandbox and written consent.
4. Do not commit `.env`, `var/`, desktop installers, APKs, owner passwords, GSTIN secrets, IRP tokens, or cloud keys.
5. Do not weaken security to make a demo pass (RLS claims, last-write-wins stock/money, supervisor importing opening books, copilot confirming its own draft).
6. If you cannot run the stack, say **Not proven** and list the blocker. Do not invent green results.
7. Deliver a written report with evidence (HTTP status, test output, file paths, commit SHA). No marketing language.

**Repo:** https://github.com/sanjaymaverick-cmd/Stoneos  
**Branch to audit:** `main` (record the exact SHA).  
**Product:** StoneOS — local-first granite factory OS for one yard (Vedam Granites and similar). NestJS `/api/v1` + Postgres 16 + Next 15 PWA. ~20–40 users. TZ `Asia/Kolkata`. Operational day starts 07:00 IST.

---

## 1. What the product claims to be

One application that runs a granite factory:

| Domain | Claim |
|---|---|
| Yard | Blocks, cutting, polishing, locations, damaged **counts** (not slab rows) |
| Sales | Order, pack → PACKING, dispatch → `dispatched` + DISPATCH movement, invoice `INV-YYYY-NNNNN`, pay, CN `CN-YYYY-NNNNN` |
| Books | One balanced voucher (paise) per invoice / pay / CN / expense. Party statements replace Khatabook |
| Opening books | One-time Khatabook customer-list import as of **2026-09-12**: 46 parties, You'll Get ₹1,25,61,248, You'll Give ₹1,63,671. Owner/manager only |
| Intake | Supervisor proposes rokad/DPR; a **different** human confirms. PDF/photo is unreadable until CSV |
| Cash | Drawer lock blocks further cash vouchers that operational day |
| Sister yards | **Ordinary customers/suppliers**. No special interfactory ledger, no slab copy across `factoryId` |
| GST | 18% inclusive split onto `GST_OUTPUT`. Mock IRN/e-way if secrets unset. GSTR-1 export; portal upload gated |
| Muster | Attendance + wage sheet; pay posts `EXP_LABOUR`; proposer ≠ confirmer; supervisor cannot pay |
| Copilot | Propose drafts only. Must not execute SQL, pay, invoice, or confirm its own draft |
| Tally | XML daybook is archive log only (`writesInventory: false`) |
| Isolation | `factoryId` from **session only**. Application `WHERE factoryId = session.factoryId`. Dual RLS is **not** claimed (ADR 0005) |
| Cloud | Optional. `workflow_dispatch` only. Never apply on push to main |

Reference docs (read all): `docs/handoff.md`, `docs/production-readiness.md`, `docs/books-khata-cutover.md`, `docs/adr/0001`–`0016`, `docs/runbooks/second-machine-restore.md`.

---

## 2. Scope of work (do all of these)

### A. Architecture and code review

- Monorepo layout: `apps/api`, `apps/web`, `apps/desktop`, `apps/android`, `packages/*`, `infra/`.
- One versioned REST surface (`/api/v1`). Flag any second write path (desktop talking to DB, Capacitor bypassing API, Tally writing inventory).
- Prisma schema vs migrations vs runtime. Confirm migrate-from-empty works.
- Idempotency: every write uses `clientOpId`; same id = same row; no last-write-wins on stock or money.
- Invoice/CN series: IST FY April–March, unique per factory, concurrent `invoice()` does not collide.
- Pack vs dispatch invariants: pack does **not** set `dispatched`; dispatch requires PACKING; reverse uses existing reverse-movement, not a backdoor.
- Damaged pieces are counts, not slab rows. Only POLISHING creates sellable stock. Recovery 105 sqft/ton at **sale** only.
- Sister-plant code: confirm there is **no** live FactoryLink / dual AR-AP / cross-factory slab copy after `20260913120000_drop_interfactory_trade`.
- Dead code, TODOs that contradict ADRs, `continue-on-error` on typecheck (must stay a hard gate), secrets in git.

### B. Workflow / SoD / operations audit

Walk each workflow as a real user (or HTTP equivalent). Record role, request, status, DB effect.

1. **No public signup.** Bootstrap creates one owner; second bootstrap must no-op.
2. **Opening inventory SoD:** line enterer ≠ approver, including when the owner started the snapshot. Factory goes LIVE only after a different user approves.
3. **Pay:** `SELECT FOR UPDATE`, 30s txn, overpay rejected in service **and** DB trigger. Double-tap same `clientOpId` = one payment.
4. **Khata import:** supervisor **403**. Totals must match the lock or the import fails. Re-import same openings is a no-op. “Cash 97070” / “Vipul Cash 108162” in Details is **narration**, not a payment. Do not mint `INV-` from debit text.
5. **Intake:** proposer cannot confirm. Bot/supervisor may propose; must not confirm own draft. DPR `derivedDpr.slabsCut` from slab rows only.
6. **Cash drawer lock:** further cash vouchers that day fail.
7. **Muster:** 6 present days × wage = line; confirm SoD; pay one voucher; supervisor cannot pay.
8. **GST:** missing GSTIN → 400; mock IRN when secrets unset; GSTR-1 includes INV- and CN-; no secrets in repo.
9. **Copilot:** propose → draft only; confirm requires a different user; no Prisma/SQL from the model; CEO dashboard numbers stay rule-based (ADR 0010 / 0011).
10. **Tally import:** log only; does not create slabs, invoices, or stock movements.
11. **Files:** tenant-scoped; cannot read another factory’s objects.

Use roles: owner, manager, admin, supervisor, operator, inventory, sales, accountant, auditor. Managers cannot grant owner. Owner cannot strip themselves of owner if that would leave the factory without one (verify actual code).

### C. Security audit

Threat model: 20–40 staff on a LAN or VPN; local-first Postgres; optional later cloud; money and stock; GST identifiers.

Minimum tests (fail closed):

| ID | Test |
|---|---|
| S1 | Unauthenticated write to any `/api/v1/*` except login/health |
| S2 | Login rate limit (~10/min/IP); session is opaque (stored hash, not raw token in DB) |
| S3 | `factoryId` in request body is ignored; session factory wins |
| S4 | User A cannot read/write User B’s factory rows (raw_block, slab, invoice, voucher, files, wage sheet) |
| S5 | Operator cannot provision users, import khata, lock drawer, pay wages, see Team/Tally/Sales as designed |
| S6 | Auditor cannot write production/inventory/pay |
| S7 | Temp-password lock: `mustChangePassword` blocks business writes until change |
| S8 | SQL injection / Prisma raw query review; no string-concat SQL with user input |
| S9 | Path traversal on `/files` and local disk storage |
| S10 | XSS/CSRF on the PWA (cookie/session flags, `apiFetch` credentials) |
| S11 | Secrets scan: `.env` not in git; GST/IRP/LLM/cloud keys absent; sample PDFs have no live passwords |
| S12 | Copilot/LLM cannot be pointed at the database; system prompt + code both forbid SQL and self-confirm |
| S13 | Reverse movement cannot resurrect sold/dispatched stock except via the documented reverse path |
| S14 | Dependency/CI: typecheck is required; `cloud-apply` does not run on push; missing cloud secrets **fail** (not skip-success) |
| S15 | Postgres: app role privileges; whether table-owner bypass makes ENABLE-only RLS a false sense of safety (document residual risk; do not “fix” by claiming dual RLS unless you implement and prove it) |

Run `node .grok/skills/security-workflows/scripts/security-check.mjs` against a live API if available, then **repeat the same cases yourself**. Do not rubber-stamp the script.

### D. Data integrity / money / GST

- Vouchers always balance; debit XOR credit per line; integer paise.
- Invoice amount is the customer total; GST 18% inclusive on sales/CN; AR still matches invoice total.
- Credit note does not silently delete the invoice.
- Wage pay and expense cash respect drawer lock if they post CASH.
- GSTR-1 month is IST, not UTC-shifted.

### E. UI / UX / role nav (if a browser is available)

- Owner walk of every `routePolicy` href at desktop and mobile (`apps/web/e2e/modules-walk.spec.ts`).
- Operator and auditor nav (`apps/web/e2e/role-nav.spec.ts`): hidden modules stay hidden; deep-link must not grant write.
- Empty and error states on Books, Intake, Muster, Sales dispatch, Khata import preview.
- `/interfactory` must **not** be in nav after the sister-trade removal.

If no browser: say so; use HTTP + routePolicy unit tests as Partial.

### F. Backup, restore, cloud (process only)

- `scripts/restore-second-machine.sh` and CI job `restore-fresh-runner`: review, do not claim a physical second PC unless a JSON from a **different hostname** exists.
- Terraform: `fmt` + `validate` only. Report if apply-from-push exists (it must not).
- Storage: local default; S3/OCI switch without leaking keys.

### G. Compliance / plant cutover (advisory)

- Khatabook retirement depends on a **live** PDF import hitting the locked totals. Fixture fillers are not Vedam legal names — flag if production still runs on fillers.
- GST e-invoice mock vs live; who files GSTR outside the app.
- Muster vs actual labour contractor process.

---

## 3. How to run (evidence, not theatre)

```bash
# Tests
npm test
npm test --workspace=@stoneos/api
npm test --workspace=@stoneos/web
npm test --workspace=@stoneos/contracts

# Typecheck is a hard gate
npm run typecheck
npm run build --workspace=@stoneos/api

# Optional live smoke (owner must supply credentials; do not print passwords in the report)
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml up -d --build
# migrate deploy + bootstrap as in docs/handoff.md
```

Integration tests use embedded Postgres on port **55432** unless `STONEOS_INTEGRATION_DATABASE_URL` is set.

Record: commit SHA, Node version, OS, which suite, pass/fail counts, and any test that was skipped.

---

## 4. Report format (required)

1. **Executive summary** — would you let this factory run money and stock on this build? Yes / Yes with conditions / No.
2. **Scope and SHA** audited.
3. **Findings table:** ID, severity (Critical / High / Medium / Low / Info), area, claim vs evidence, recommendation.
4. **Workflow matrix:** each workflow in §2B with Pass/Partial/Fail/Not proven.
5. **Security matrix:** S1–S15.
6. **Residual risks** the owner must accept (application-level isolation vs RLS, mock GST, no second-PC restore proof, copilot if an API key is later set).
7. **Out of scope / not tested.**
8. **Appendix:** commands, HTTP traces (redact secrets), file paths.

Severity guide:

- **Critical:** money or stock can be created, deleted, or moved across factories; auth bypass; secrets in git.
- **High:** SoD bypass (opening, pay, khata import, intake confirm, wage pay); overpay; INV collision.
- **Medium:** role-nav leak that still 403s on API; GST mock mistaken for live filing; copilot over-reach without posting.
- **Low/Info:** docs drift, unused enum values, UX.

---

## 5. Explicit non-goals

- Do not merge `ston3gpt` / `stoneos3`.
- Do not re-add in-app sister-plant dual ledgers.
- Do not turn Copilot into a SQL agent.
- Do not apply Terraform.
- Do not store real Vedam owner passwords in the report appendix in plaintext if avoidable; say “owner credential used; rotated after audit.”

---

## 6. Prompt (paste this to the auditor)

You are an independent product, code, workflow, and security auditor. Audit StoneOS at repo `sanjaymaverick-cmd/Stoneos` on branch `main` at the SHA you record. Follow `docs/third-party-audit-brief.md` in full.

Independence: do not take ADRs or `docs/production-readiness.md` checkboxes as true. Prove each claim with tests, HTTP, or Playwright. Classify Pass / Partial / Fail / Not proven.

Cover: architecture and code review; factory workflows and segregation of duties; RBAC and tenant isolation; books/vouchers/GST; khata cutover; intake SoD; cash drawer; dispatch; muster; copilot propose-only; Tally archive-only; backup/restore; CI and cloud-apply gating; secrets; dependency and typecheck gate.

Output the report format in §4. Fail closed on money, stock, and cross-factory access. Do not terraform apply. Do not commit secrets.
