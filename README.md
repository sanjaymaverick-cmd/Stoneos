# StoneOS

Production granite factory management platform. Clean-room TypeScript monorepo.

Reference repositories (`ston3gpt`, `stoneos3`) were audited and **not merged**. See `docs/reference-matrix.md`.

## Layout

```
apps/api          NestJS REST API (/api/v1, OpenAPI at /api/docs)
apps/web          Next.js PWA
apps/desktop      Electron Windows shell
apps/android      Capacitor Android shell
packages/*        contracts, domain rules, auth, sync-client, storage
infra/compose     local Postgres and production-image smoke
infra/terraform   optional later AWS/OCI blueprints (hosting not chosen)
docs/             ADRs and runbooks
```

## Local development

```bash
cp .env.example apps/api/.env
docker compose -f infra/compose/docker-compose.yml up -d
npm install
npm run db:generate
npm run db:migrate
npm run bootstrap
npm run dev:api
npm run dev:web
```

Open http://localhost:3000. Sign in as `owner` / `ChangeMeNow!12` and change the password.

There is **no public signup**. Only owners and managers can issue staff credentials. Managers cannot create or revoke owners.

## Tests

```bash
npm test
```

CI runs lint/typecheck (tsc), Prisma validate + migrate deploy, unit/integration tests, production builds, Docker image builds, Terraform validate, and Trivy.

## Deployment

Local first: Docker Compose (`infra/compose/`) plus `npm run dev:api` / `dev:web`, or the prod-image smoke stack. Prove health, login, and factory workflows here before any cloud.

Later (hosting not chosen): same images on AWS, OCI, or a similar private VPC. Terraform under `infra/terraform/` is a blueprint only — do not apply until the platform is confirmed. Runbooks: `docs/runbooks/`.

## Classification

Do not assume a page means a feature is proven. See `docs/production-readiness.md` for the evidence table after tests have been run.

Grok continuation: `docs/handoff.md`.
