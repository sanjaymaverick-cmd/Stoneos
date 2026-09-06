# Handoff for Grok

Continue this StoneOS session from `origin/main`. Repo: https://github.com/sanjaymaverick-cmd/Stoneos — workspace `D:\\work Dir\\stoneOS`.

## Intent

Local-first granite factory platform. Build and test on this workstation. Host later on **AWS, OCI, or similar** — **do not `terraform apply`** until the user names a platform. Copilot/grounded AI is deferred (ADR 0009). The CEO dashboard is **rule-based ledger math** (ADR 0010), not a model.

Reference repos (`ston3gpt`, `stoneos3`) were audited and **not merged**. Reimplement rules; do not copy blindly.

## Run local (current “server”)

Prod-shaped smoke stack:

```bash
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml up -d --build
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml exec -T api npx prisma migrate deploy --schema prisma/schema.prisma
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml exec -T api npx tsx src/bootstrap.ts
```

Stop:

```bash
docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml down
```

- Web http://localhost:3000/login
- API http://localhost:4000  OpenAPI `/api/docs`
- Health `/health/live` and `/health/ready`

Postgres in this compose file is ephemeral unless Docker reuses an anonymous volume. After a wipe, bootstrap creates factory **Vedam Granites** and owner `owner` / `ChangeMeNow!12` (`mustChangePassword: true`).

**Live owner password after year-run on this machine:** `YearRunOwner!12` (bootstrap password no longer works if that run completed). Confirm with `POST /api/v1/auth/login` before telling the user.

Year-run staff (if provisioned): `yrunmgr`, `yrunadm`, `yrunsup`, `yrunopr`, `yruninv`, `yrunsls`, `yrunacc`, `yrunaud` — passwords `YearRunXxx!12` (e.g. `yrunopr` / `YearRunOpr!12`).

There is **no public signup**.

## Agents (run against live API, not mocks)

| Invoke | Script / proof |
|---|---|
| `/factory-year-run` | `STONEOS_OWNER_PASSWORD=… npm run year-run` → `var/year-run-report.json` |
| `/security-workflows` | `node .grok/skills/security-workflows/scripts/security-check.mjs` → `var/security-workflow-review.md` |
| `/ui-ux-modules` | `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --config apps/web/playwright.config.ts apps/web/e2e/modules-walk.spec.ts` → `var/ui-ux-module-review.md` |

Login is **10/min per IP**. Year-run logs in owner + 8 staff; wait ~65s after a burst or the script retries once on 429. Authenticated API traffic is **600/min per IP+token**; anonymous **120/min**.

Last live run after rebuild (2026-09-06): year-run **0 unexpected failures** / 12 months / payments **201**; security **10/10**; UI walk **pass** desktop+mobile. CEO brief HTTP not yet recorded after 2026-09-06 code land.

## Architecture (do not regress)

- Monorepo: NestJS API `apps/api` (`/api/v1`), Next 15 PWA `apps/web`, Electron `apps/desktop`, Capacitor `apps/android`.
- Username + opaque session (SHA-256 of token stored). scrypt passwords. `factoryId` from session only.
- Roles: owner, manager, supervisor, operator, inventory, sales, accountant, auditor, admin. Managers cannot grant owner. `PAYMENT_ROLES` = sales writers + accountant. `CEO_ROLES` = owner, manager, accountant, auditor, admin.
- `factory_id` is **TEXT**. Isolation is application `WHERE factoryId = session.factoryId`. RLS is ENABLE-only (table owner exempt; `withFactory` unused). Idempotency `(factoryId, clientOpId)`. Invoice numbers are factory + IST FY (April–March) sequences (`INV-YYYY-NNNNN`).
- Operational day 07:00. Recovery 105 sqft/ton at sale. Damaged cost at raw-block cost. Damaged pieces are counts, not slab rows.
- API image runs `tsx` + explicit `@Inject()` (tsx does not emit `design:paramtypes`). Copy `tsconfig.base.json` into the API image.
- Web: `apiFetch<T = any>`, extensionless imports in contracts/sync-client, `transpilePackages`, `allowImportingTsExtensions`.
- Electron-builder: `npmRebuild: false` or `app-builder.exe` vanishes in workspaces.

## Tests

`npm test` workspaces: last recorded **30 pass / 0 fail**. After CEO work expect contracts +1 and domain +4. Playwright: `apps/web/e2e/login.spec.ts` and `modules-walk.spec.ts`.

Embedded Postgres for API integration tests: port **55432**, `initdb --encoding=UTF8 --locale=C`. Approve `@embedded-postgres/windows-x64` scripts if hydrate fails.

## Do not

- `terraform apply` (OCI validated only; AWS module is a draft).
- Enable Copilot / grounded AI.
- Commit `.env`, `var/`, `apps/desktop/dist/`, APKs, `apps/android/android/`.
- Claim a feature works because a page exists — classify proven / partial / failed from HTTP or Playwright.

## Useful next local work

- Rebuild smoke after this pull: `up -d --build`, then `GET /api/v1/reports/ceo` as owner and operator (operator must 403).
- Timed backup/restore rehearsal (`docs/runbooks/backup-restore.md`).
- Opening-count SoD on the live factory (`operatingStatus` may still be `SETUP` until opening is approved).
