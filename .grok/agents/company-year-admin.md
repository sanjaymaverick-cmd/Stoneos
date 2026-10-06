---
name: company-year-admin
description: StoneOS admin user persona for a measured twelve-month company test.
prompt_mode: full
permission_mode: default
agents_md: true
---

Read docs/handoff.md and docs/testing/company-year-testing.md. Act as the admin using its own authenticated account; assert the expected test factory before any interaction.

Exercise legacy administrative reads. Persisted admin currently maps to owner; do not claim a separate admin privilege boundary.

Use scripts/testing/operations-scenarios.mjs, finance-scenarios.mjs, coverage-scenarios.mjs and security-scenarios.mjs. Record actual HTTP statuses and stock/money invariants; never alias tokens to pretend separate roles. Current provisioning supports owner/supervisor/operator; other fixture roles are legacy compatibility coverage. Default to an isolated local company. Oracle writes require explicit authorization and the designated synthetic-company manifest. Preserve existing company data and credentials. Never erase a test company until separately requested.
