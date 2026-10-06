# Company-year testing agents

User-authorized Oracle run completed on 5 October 2026. See [results](company-year-results-2026-10-05.md) and [UI/UX backlog](ui-ux-improvements-2026-10-05.md).

Nine role personas live in .grok/agents/company-year-*.md; a separate UI/UX agent covers task discovery, desktop/mobile behavior and factory volume. Every persona uses a separate real account. Current application provisioning offers owner, supervisor and operator; manager/admin and inventory/sales fixture identities test the persisted compatibility mappings, while accountant/auditor are read-only. They are not evidence of nine distinct newly provisionable privilege models.

## Execution and evidence

- operations-scenarios.mjs: deterministic 264-day plan, raw receipts, B21 cutting, grinding/resin/polishing, nine consumable types, paid royalty/transport allocations and maintenance.
- finance-scenarios.mjs: cash/credit/dealer/bill-and-cash companion orders, packing/dispatch/invoices/collections, returns, finished purchases, expense/payroll, GST, reports, intake, Tally and provider boundaries.
- coverage-scenarios.mjs: count-based lots, partial dispatch, invoice retry, breakage, attachments, inventory reversal, cost review, standards and security negatives.
- run-company-year.mjs: real REST orchestration and checkpoints, original piece-order retention and cached successful steps for safe recovery. Prior evidence is reused on recovery; replay checks are executed on the initial run.
- security-scenarios.mjs: real public API controls and synthetic-tenant assertions.
- ui-ux-audit.mjs: all static screens, actual party statement, five personas and two viewports; targeted recheck corrects wrapped-select locator assumptions without repeating the whole audit.

Default to a fresh local company. This specific Oracle run was explicitly authorized and guarded by factory ID 5c183b6d-44b6-4e46-9744-3b705df6d38a. A new run requires its own reviewed fixture manifest; do not replace the allowlist with a real-company ID. Normal operational timestamps older than 14 days are rejected. Historical simulation used a private loopback API process with the same deployed code/database and an async-scoped clock, restricted to the synthetic factory. The public API clock/validation were unchanged. Seed, clock and verifier scripts and private manifests are under ignored var/company-year; do not commit tokens or fixture passwords.

The retained Oracle test company is DRY RUN 12 MONTHS — 2026-10-05 — TEST COMPANY. Synthetic owner access is in var/company-year/fixture.json; it is separate from the real owner. Existing company fingerprints and credentials were verified unchanged. All scenario output is synthetic, not statutory filing evidence.

Do not rerun completed scripts blindly: run-company-year.mjs must use its saved fixture and checkpoints. Consumable rates, four-worker payroll, 22 monthly working days and all-credit quarry purchases are declared test assumptions. Suppliers are paid for royalty, transport, supplies and finished receipts; later quarry/AP settlement remains a product gap. Opening stock was tested only for rejecting re-opening a LIVE company; a new SETUP-company positive approval is not claimed. Live OpenAI and statutory production adapters remain unverified.

## Cleanup boundary

No test-company data was erased. Future cleanup must be separately authorized and scoped to the recorded factory ID and its dependent rows/files/sessions. Preserve all pre-existing companies, owner credentials and deployment configuration. Do not run global truncation or reset.
