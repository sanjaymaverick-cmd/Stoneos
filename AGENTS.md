# StoneOS agents

Local-first granite factory app. Postgres 16 via Compose. Do not terraform apply until a host is chosen.

| Agent | Invoke | Does |
|---|---|---|
| factory-year-run | `/factory-year-run` | 12-month dry company run on the live local API; all staff roles |
| security-workflows | `/security-workflows` | RBAC, sessions, tenant isolation, temp-password lock on live workflows |
| ui-ux-modules | `/ui-ux-modules` | Every web module at desktop and mobile, including hidden-role nav |

Skills live in `.grok/skills/`. Agent definitions live in `.grok/agents/`. Year-run script: `node .grok/skills/factory-year-run/scripts/year-run.mjs`.
