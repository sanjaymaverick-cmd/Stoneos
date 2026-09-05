---
name: factory-year-run
description: >
  Execute a 12-month granite factory dry run on the real local Postgres via REST.
  Provisions every role and exercises inventory, production, sales, expenses, and
  reports. Use when the user asks for a year run, dry company run, all user types,
  or /factory-year-run.
---

# Factory year run

Target the **running local API** (`http://localhost:4000` unless `STONEOS_API_URL` is set). Do not simulate in memory.

## Steps

1. `GET /health/live` and `GET /health/ready`. If either fails, start the local stack (`docker compose -p stoneos-smoke -f infra/compose/docker-compose.prod.yml up -d` or `docker compose -f infra/compose/docker-compose.yml up -d` plus `npm run dev:api`) and wait until ready.
2. Run:

```bash
node .grok/skills/factory-year-run/scripts/year-run.mjs
```

Optional env: `STONEOS_API_URL`, `STONEOS_OWNER_USER` (default `owner`), `STONEOS_OWNER_PASSWORD` (default `ChangeMeNow!12`).

3. Read `var/year-run-report.json`.
4. Summarize: staff provisioned, months completed, writes per module, expected 403s, unexpected failures.
5. If the owner still had `mustChangePassword`, the script sets password to `YearRunOwner!12`. State that in the report.

Done when the report file exists and every module is labeled proven, partial, or failed with the HTTP status that justified the label.
