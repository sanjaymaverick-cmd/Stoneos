# Production-readiness checklist

## Automated test report (2026-09-05, this workstation)

Command: `npm test` per workspace (`node --test`). Docker Desktop Linux engine was **not running**, so PostgreSQL integration did not execute.

| Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| `@stoneos/contracts` | 3 | 0 | 0 |
| `@stoneos/domain` | 5 | 0 | 0 |
| `@stoneos/auth` | 3 | 0 | 0 |
| `@stoneos/sync-client` | 1 | 0 | 0 |
| `@stoneos/storage` | 2 | 0 | 0 |
| `@stoneos/api` unit | 5 | 0 | 0 |
| `@stoneos/api` unit | 5 | 0 | 0 |
| `@stoneos/api` postgres workflows | 8 | 0 | 0 |
| `@stoneos/web` route policy | 3 | 0 | 0 |
| **Total** | **30** | **0** | **0** |

Embedded PostgreSQL 18.4 applied both Prisma migrations on this workstation (Docker engine still unavailable).

- [x] `npm test` pass/fail counts recorded (**30 pass / 0 fail**)
- [x] Goods-receipt `clientOpId` retry does not create a second block
- [x] Vehicle expenses require a same-factory vehicle
- [x] Prisma migrate deploy on empty Postgres (embedded 18.4)
- [x] Bootstrap-equivalent owner login + session revoke
- [x] Manager cannot grant owner
- [x] Cross-tenant raw block hidden
- [x] Cutting damaged slabs not stocked
- [x] Opening approval requires a different user, then factory goes LIVE
- [x] Invoice retry idempotent; overpay rejected
- [ ] Prisma migrate deploy on empty Postgres 16
- [ ] Bootstrap refuses a second owner
- [ ] Manager cannot grant owner
- [ ] Cross-tenant raw block hidden
- [ ] Cutting damaged slabs not stocked
- [ ] Invoice retry idempotent; overpay rejected
- [ ] `/health/ready` against Docker API image
- [ ] PWA manifest served
- [ ] Terraform validate OCI and AWS
- [ ] Backup restore rehearsal timed
- [ ] No production credentials used in tests
- [ ] Copilot not enabled

Remaining product gaps: native APK/NSIS artifacts must be built on Windows/Android Studio; cloud apply is an environment gate; Copilot is deferred.
