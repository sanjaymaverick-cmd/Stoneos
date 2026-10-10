# StoneOS agents

Read `docs/handoff.md` before continuing this project. Deploying to the live Oracle box: `docs/runbooks/oci-deploy-handoff.md`. Local-first granite factory app. Postgres 16 via Compose. Do not terraform apply until a host is chosen.

| Agent | Invoke | Does |
|---|---|---|
| factory-year-run | `/factory-year-run` | 12-month dry company run on the live local API; all staff roles |
| security-workflows | `/security-workflows` | RBAC, sessions, tenant isolation, temp-password lock on live workflows |
| ui-ux-modules | `/ui-ux-modules` | Every web module at desktop and mobile, including hidden-role nav |

Skills live in `.grok/skills/`. Agent definitions live in `.grok/agents/`. Year-run script: `node .grok/skills/factory-year-run/scripts/year-run.mjs`.

Business data entry rule: enter operational records through available StoneOS UI screens, using the same workflow as a real user. If a screen is missing, build it before entering the data. Do not use direct database writes or server import scripts for business entry. User-authorized deletion is the sole exception. Schema migrations and read-only verification remain allowed.
