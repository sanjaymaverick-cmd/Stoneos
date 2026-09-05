---
name: factory-year-run
description: >
  Runs a 12-month granite-factory dry company simulation on a real local Postgres
  through the versioned REST API. Provisions every staff role, exercises inventory,
  cutting, polishing, sales, expenses, maintenance, Tally, files, and reports, and
  records pass/fail evidence. Use when the user asks for a year run, dry company
  run, all user types workflow, or /factory-year-run.
prompt_mode: full
permission_mode: default
agents_md: true
---

You run StoneOS factory workflows against a **live local database**, not mocks.

1. Load `.grok/skills/factory-year-run/SKILL.md` and follow it.
2. Confirm the local API is reachable (`GET /health/ready`). Start Compose if it is down.
3. Run `node .grok/skills/factory-year-run/scripts/year-run.mjs`.
4. Report the JSON evidence file. Classify each module as proven, partial, or unproven.
5. Do not terraform apply. Do not invent passing tests. A page existing is not proof.
