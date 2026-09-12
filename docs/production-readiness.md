# Production-readiness checklist

## Automated test report (2026-09-06, this workstation)

Command: `npm test` per workspace (`node --test`). API integration uses embedded Postgres 18.4 on port 55432 (`STONEOS_INTEGRATION_DATABASE_URL` to point at an external DB).

| Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| `@stoneos/contracts` | 5 | 0 | 0 |
| `@stoneos/domain` | 17 | 0 | 0 |
| `@stoneos/auth` | 3 | 0 | 0 |
| `@stoneos/sync-client` | 5 | 0 | 0 |
| `@stoneos/storage` | 2 | 0 | 0 |
| `@stoneos/api` unit | 8 | 0 | 0 |
| `@stoneos/api` postgres workflows | 20 | 0 | 0 |
| `@stoneos/web` route policy | 4 | 0 | 0 |
| **Total** | **64** | **0** | **0** |

Playwright (earlier smoke stack `localhost:3000` / `localhost:4000`): 2 passed (no public signup; owner login forced to change bootstrap password).

Owner module walk on current smoke (2026-09-12): **1 passed** (`apps/web/e2e/modules-walk.spec.ts`, desktop 1280×800 + mobile 390×844, every `routePolicy` href + login + password). Report `var/ui-ux-module-review.md`. Blockers: none.

Operator + auditor nav walk (2026-09-12): **2 passed** (`apps/web/e2e/role-nav.spec.ts`). Operator nav has no Team/Tally/Sales/Expenses/Audit; provision submit as operator does not mint a password. Auditor nav shows CEO+Audit, not Production/Maintenance/Consumables.

- [x] `npm test` pass/fail counts recorded (**30 pass / 0 fail** as of 2026-09-05)
- [x] Goods-receipt `clientOpId` retry does not create a second block
- [x] Vehicle expenses require a same-factory vehicle
- [x] Prisma migrate deploy on empty Postgres (embedded 18.4)
- [x] Bootstrap-equivalent owner login + session revoke
- [x] Manager cannot grant owner
- [x] Cross-tenant raw block hidden
- [x] Cutting damaged slabs not stocked
- [x] Opening approval requires a different user, then factory goes LIVE
- [x] Opening SoD is line-enterer, not starter: owner-start + owner-enter + owner-approve is 403; 150-line approve keeps payload tons/cost
- [x] Live smoke SoD: owner-enter approve 403, manager approve 201, factory LIVE (`SOD-LIVE-1`)
- [x] Invoice retry idempotent; overpay rejected (service lock + DB trigger)
- [x] Concurrent `invoice()` calls get distinct `INV-YYYY-NNNNN` (IST FY April–March)
- [x] Grinding completion does not move slabs to finished stock; sold slabs cannot be un-sold by polish
- [x] DPR `slabsCut` equals slab rows from `completeCutting` in the operational-day window
- [x] Invoiced return issues `CN-YYYY-NNNNN` and leaves the invoice standing
- [x] `pack()` does not change slab `salesStatus`/location and emits no `PACKING` movement (no reverse path)
- [x] Interfactory: owner can register sister plants; link posts counterpart customers; invoice to a sister posts AP on the buyer; settlement pays seller AR and buyer AP together (idempotent). Stock is not auto-received on the buyer.
- [x] Prisma migrate deploy on empty Postgres 16 (Docker `postgres:16-alpine` in `stoneos-smoke`)
- [x] Bootstrap refuses a second owner (CLI no-ops after lock; first run created Vedam Granites / `owner`)
- [x] `/health/live` and `/health/ready` against Docker API image
- [x] Owner login against Docker API (`mustChangePassword: true`)
- [x] PWA manifest served (`GET /manifest.webmanifest` 200, `application/manifest+json`)
- [x] Windows NSIS installer built (`apps/desktop/dist/StoneOS Setup 0.1.0.exe`, gitignored)
- [x] Android debug APK built (`apps/android/android/app/build/outputs/apk/debug/app-debug.apk`, gitignored)
- [x] Terraform `init -backend=false` + `validate` for OCI (`oracle/oci` 6.37.0)
- [ ] Terraform apply (not now: local-first; AWS / OCI / similar later)
- [x] Prod Compose mounts `stoneos_pg_data`; `scripts/backup-rehearse.sh` dumps off-disk and restores into `stoneos_restore`
- [ ] Timed restore drill on a second *machine* (script ready; second-*disk* rehearsal done on this workstation)
- [x] `HOST_BACKUP_DIR=E:/stoneos-backups` `scripts/backup-rehearse.sh` → `var/backup-rehearse.json` (5s; dump on E:; restore counts raw_block=1 invoice=1 payment=1)
- [x] Invoice pay takes `SELECT … FOR UPDATE`; sales UI mints one `clientOpId` per invoice/payment, not per click
- [x] Pay/invoice interactive transactions use 30s timeout (year-run first pay hit Prisma 5s P2028)
- [x] Factory file uploads write to `STORAGE_LOCAL_DIR=/app/apps/api/data/storage` (not `./var`)
- [x] Deny-by-default `@Roles`; CSV locked to `CEO_ROLES`; every `slabId` factory-checked
- [x] Audited `POST /inventory/movements/:id/reverse` for receipt / reservation / delivery mistypes
- [x] `TZ=Asia/Kolkata` in API image + Compose; operational-day tests use `Z` instants
- [x] Domain/API test globs include CEO + guard cases; CI sets `TZ` and runs guard unit tests
- [x] CEO brief `GET /api/v1/reports/ceo` on smoke after rebuild: operator 403, owner 200, auditor 200 (`var/week-one-smoke.json`)
- [x] Double-tap payment same `clientOpId` → one payment row (HTTP 201/201, same id; invoice `INV-2026-00001`)
- [x] Reverse goods receipt voids the block; same `clientOpId` retry is a no-op (`SMOKE-REV-1` currentStatus=voided)
- [x] No production credentials used in tests
- [x] Copilot not enabled

Smoke rebuild 2026-09-06 used named volume `stoneos-smoke_stoneos_pg_data`. Owner password on this stack is `YearRunOwner!12`. Year-run staff (`yrunopr`, …) **were provisioned** on that volume. A previous volume `compose_stoneos_pg_data` still exists and was not attached.

**2026-09-12 this workstation:** smoke stack was up; owner Playwright walk passed (desktop+mobile). `restore-second-machine.sh` still belongs on a **different PC**. `terraform apply` not run. Copilot not enabled. PACKING reverse not added (`pack()` still creates a packing list only). Dual RLS not claimed.

Year-run on this named volume (2026-09-06): 12 months, staff `yrunmgr`…`yrunaud` provisioned. First-pass pay 500 (P2028 5s) and files 500 (`mkdir var`) were fixed and retried 201. Security-check **15/15**. Live opening SoD: owner-enter cannot approve; manager approve → LIVE.

Remaining local work: run `scripts/restore-second-machine.sh` on a **different PC** against a dump from `HOST_BACKUP_DIR` and keep `var/restore-second-machine.json`. Cloud apply waits until a host is chosen. Copilot stays deferred (ADR 0009). CEO dashboard is rule-based (ADR 0010). Isolation is application `WHERE` (ADR 0005). PACKING reverse is not shipped — `pack()` does not mutate stock.

CI (2026-09-08): quality no longer dies on `npm audit` before tests; AWS `main.tf` is `terraform fmt`-clean; Trivy action pinned to `v0.36.0` (do not use yanked `0.24.0`). Quality job also dumps/restores the migrated schema on the CI Postgres. Playwright module-walk stays on the smoke stack (`PLAYWRIGHT_SKIP_WEBSERVER=1 STONEOS_OWNER_PASSWORD=YearRunOwner!12 npm run test:e2e --workspace=@stoneos/web`).
