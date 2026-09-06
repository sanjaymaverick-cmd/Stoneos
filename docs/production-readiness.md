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
| `@stoneos/api` postgres workflows | 18 | 0 | 0 |
| `@stoneos/web` route policy | 3 | 0 | 0 |
| **Total** | **61** | **0** | **0** |

Playwright (earlier smoke stack `localhost:3000` / `localhost:4000`): 2 passed (no public signup; owner login forced to change bootstrap password). Not re-run on this rebuild.

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
- [x] Invoice retry idempotent; overpay rejected (service lock + DB trigger)
- [x] Concurrent `invoice()` calls get distinct `INV-YYYY-NNNNN` (IST FY April–March)
- [x] Grinding completion does not move slabs to finished stock; sold slabs cannot be un-sold by polish
- [x] DPR `slabsCut` equals slab rows from `completeCutting` in the operational-day window
- [x] Invoiced return issues `CN-YYYY-NNNNN` and leaves the invoice standing
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
- [x] Deny-by-default `@Roles`; CSV locked to `CEO_ROLES`; every `slabId` factory-checked
- [x] Audited `POST /inventory/movements/:id/reverse` for receipt / reservation / delivery mistypes
- [x] `TZ=Asia/Kolkata` in API image + Compose; operational-day tests use `Z` instants
- [x] Domain/API test globs include CEO + guard cases; CI sets `TZ` and runs guard unit tests
- [x] CEO brief `GET /api/v1/reports/ceo` on smoke after rebuild: operator 403, owner 200, auditor 200 (`var/week-one-smoke.json`)
- [x] Double-tap payment same `clientOpId` → one payment row (HTTP 201/201, same id; invoice `INV-2026-00001`)
- [x] Reverse goods receipt voids the block; same `clientOpId` retry is a no-op (`SMOKE-REV-1` currentStatus=voided)
- [x] No production credentials used in tests
- [x] Copilot not enabled

Smoke rebuild 2026-09-06 used a **new** named volume `stoneos-smoke_stoneos_pg_data` (fresh bootstrap). Owner password on this stack is `YearRunOwner!12`. Year-run staff (`yrunopr`, …) are not on this volume. A previous volume `compose_stoneos_pg_data` still exists and was not attached.

Remaining local work: second-machine restore drill; year-run against this named volume if those books are required. Cloud apply waits until a host is chosen. Copilot stays deferred (ADR 0009). CEO dashboard is rule-based (ADR 0010). Isolation is application `WHERE` (ADR 0005). PACKING reverse is not shipped — `pack()` does not mutate stock.
