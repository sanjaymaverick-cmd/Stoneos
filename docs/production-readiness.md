# Production-readiness checklist

## Automated test report (2026-09-05, this workstation)

Command: `npm test` per workspace (`node --test`).

| Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| `@stoneos/contracts` | 3 | 0 | 0 |
| `@stoneos/domain` | 5 | 0 | 0 |
| `@stoneos/auth` | 3 | 0 | 0 |
| `@stoneos/sync-client` | 1 | 0 | 0 |
| `@stoneos/storage` | 2 | 0 | 0 |
| `@stoneos/api` unit | 5 | 0 | 0 |
| `@stoneos/api` postgres workflows | 8 | 0 | 0 |
| `@stoneos/web` route policy | 3 | 0 | 0 |
| **Total** | **30** | **0** | **0** |

Recount after CEO work (2026-09-06, code only — not yet re-run on the factory workstation):

- contracts: +1 CEO_ROLES test (expect 5)
- domain: +4 CEO brief tests (expect 9)

Playwright (smoke stack `localhost:3000` / `localhost:4000`): 2 passed (no public signup; owner login forced to change bootstrap password).

- [x] `npm test` pass/fail counts recorded (**30 pass / 0 fail** as of 2026-09-05)
- [x] Goods-receipt `clientOpId` retry does not create a second block
- [x] Vehicle expenses require a same-factory vehicle
- [x] Prisma migrate deploy on empty Postgres (embedded 18.4)
- [x] Bootstrap-equivalent owner login + session revoke
- [x] Manager cannot grant owner
- [x] Cross-tenant raw block hidden
- [x] Cutting damaged slabs not stocked
- [x] Opening approval requires a different user, then factory goes LIVE
- [x] Invoice retry idempotent; overpay rejected
- [x] Prisma migrate deploy on empty Postgres 16 (Docker `postgres:16-alpine` in `stoneos-smoke`)
- [x] Bootstrap refuses a second owner (CLI no-ops after lock; first run created Vedam Granites / `owner`)
- [x] `/health/live` and `/health/ready` against Docker API image
- [x] Owner login against Docker API (`mustChangePassword: true`)
- [x] PWA manifest served (`GET /manifest.webmanifest` 200, `application/manifest+json`)
- [x] Windows NSIS installer built (`apps/desktop/dist/StoneOS Setup 0.1.0.exe`, gitignored)
- [x] Android debug APK built (`apps/android/android/app/build/outputs/apk/debug/app-debug.apk`, gitignored)
- [x] Terraform `init -backend=false` + `validate` for OCI (`oracle/oci` 6.37.0)
- [ ] Terraform apply (not now: local-first; AWS / OCI / similar later)
- [ ] Backup restore rehearsal timed
- [ ] CEO brief `GET /api/v1/reports/ceo` proven on smoke after rebuild (code landed; HTTP not yet recorded)
- [x] No production credentials used in tests
- [x] Copilot not enabled

Remaining local work is factory-workflow testing on Compose. Cloud apply waits until a host is chosen. Copilot stays deferred (ADR 0009). CEO dashboard is rule-based (ADR 0010).
