# StoneOS continuation handoff — 3 October 2026

Start from the latest origin/main in https://github.com/sanjaymaverick-cmd/Stoneos. Read AGENTS.md, docs/handoff.md, this update and docs/runbooks/oci-deploy-handoff.md. Older handoff notes describe historical smoke data; do not treat them as the current production state.

## User intent

Record every StoneOS sale: local consumer, dealer/credit, cash, billed, and split cash/bill. Khatabook is a feature reference, not the complete source of sales: the user only records credit/dealer sales there. Never import Khatabook data without a new request. StoneOS reports must support all history and custom periods longer than one year. Keep the interface simple.

## Delivered changes

PR #28 adds invoice dates to both per-slab and lot billing. Dates drive fiscal numbering, ledger posting, daily reports and GSTR-1. Existing invoices are backfilled from original IST creation dates without changing creation timestamps or financial amounts.

/sales/reports shows customer/supplier statements, detailed dues, sales/purchases, payments made/received and modes. Excel has summaries, transactions, payments and notes. PDF uses browser Print / Save PDF. Dates have no one-year cap. Opening balances precede the filtered activity; dues run through the end date. Advances are separate. Cash sales and split-sale cash legs are included once; source vouchers represented by documents are excluded. Historical payment modes that were not stored are Not recorded.

/parties provides buyer and supplier creation, editing and search with names, phone, GSTIN/state, billing address and delivery/pickup address. Sell and Yard link to it; Yard uses the same full supplier form. Supplier addresses are nullable additive fields. GSTIN format and contradictory state checks run on the API. Edits are factory scoped. Master-data read access mirrors buyer read access; supplier/buyer writes retain their existing role groups.

## Deployment

Production: https://stoneos.duckdns.org on ubuntu@193.122.159.175, checkout /opt/stoneos, Compose directory /opt/stoneos/deploy/oci. Existing authorized SSH key is C:/Users/BHAGWAN/Downloads/ssh-key-2026-09-30.key. Never print .env, secrets, or owner credentials. The original local checkout is D:/work Dir/stoneOS; this task used an isolated worktree under Documents/Codex/2026-10-02/stoneos-yard-board/work/sell-reports. Preserve user branches and uncommitted work.

Deploy main using the repository redeploy script in the background and monitor status.sh. Commit f96a6ce (PR #28) was verified running on Oracle. Its first migration step reused an old stoneos-migrate image: logs misleadingly said 12 migrations/no pending while the API needed invoice_date. This was fixed live by running Prisma migrate deploy inside the newly built API image; the report page then loaded successfully. redeploy.sh now runs the migrate task with --build so subsequent deployments use current migrations. Confirm the new supplier-address migration is applied after deployment; readiness alone does not prove schema compatibility.

For manual schema verification, execute Prisma migrate status or deploy in the current API container from /app/apps/api. Do not use an old migration image. The migrations are 20261003120000_invoice_date and 20261003150000_supplier_addresses.

## Validation and continuation

Invoice/report changes passed API and web typechecks, production web build, 145 API tests, repository CI including image builds and restore drill, and phone/desktop report download checks. Cash-only and split-sale assertions verify full cash collection, both sale portions and unpaid billed dues. Supplier changes add persistence/clearing/GST/factory-isolation integration checks and a phone browser create/edit/reload check. Re-run relevant checks for later changes.

Reports read financial documents and manual AR/AP entries in a repeatable-read snapshot, scoped to factory. Do not replace document amounts with recomputed tax. Test against disposable local/CI databases; do not write mock transactions into production to prove behavior.

Earlier database cleanup was explicitly authorized and completed except owner login and required factory. The user may have added real records since; never repeat that cleanup implicitly. Owner sessions/passwords must be preserved. No further deletion is part of this work.

Known operational item: offsite backup upload and backup timer are not configured. The deployment script creates its existing local predeploy backup. Do not provision cloud infrastructure or expose PostgreSQL without a specific request.

No automatic future-work task was scheduled. Continue from the latest merged code and the user's next request.

## Final deployment verification

PRs #28 and #29 are merged. Oracle runs main commit 46a394067dfe2777b0ead8860018fab5f256029e (PR #29). DEPLOY_EXIT=0; API and PostgreSQL are healthy. Prisma migrate status confirms all 17 migrations applied, including supplier addresses. This transition was started with the old script copy, so the supplier migration was explicitly applied from the current API image. Future redeploys have --build on the migrate task.

Live authenticated /parties loaded buyer data and the full supplier form without a production test write. Local validation passed 146 API tests, workspace typechecks, web production build, and supplier create/edit plus buyer browser check. Both PRs passed all five CI jobs. The original D:/work Dir/stoneOS checkout was preserved.

Repository handoff: docs/handoff-2026-10-03.md, linked from docs/handoff.md. This standalone copy includes the final deployed commit and schema verification.


## Isolated demo and promotional media — 3 October 2026

User explicitly selected an isolated demo copy. Never replay these scripts against production. No production transactions were created by this run.

- Demo artifacts: C:/Users/BHAGWAN/Documents/Codex/2026-10-02/stoneos-yard-board/demo-video
- Promotional edit: StoneOS-Promotional-Video.mp4, 15 chapters, English synthetic narration, approximately 135 seconds, 1600 × 900.
- Raw main, supporting-module and offline screen recordings are retained as WebM.
- Coverage and limitations: demo-video/StoneOS-Dry-Run-Report.md; sanitized machine evidence: StoneOS-Dry-Run-Evidence.json plus supporting results.
- Isolated real API http://127.0.0.1:4007; web http://127.0.0.1:3007; embedded PostgreSQL 127.0.0.1:55435, database stoneos_dry_run, data in ignored var/investor-demo. No live credentials used for testing or media.
- Current local processes: PG session24928, API15629, web42305. Do not rerun start.mjs blindly: initialization already completed. Fixture and recording scripts live under work/sell-reports/var/investor-demo and contain local-only synthetic credentials.
- Opening-stock approval was exercised in a separate demo onboarding factory; main demo company remains live locally.
- Subsequent agent should inspect report limits: existing Vedam branding vs requested StoneOS name; initial service-worker cold-load dashboard fallback; archive import frozen totals; unsupported kg unit; rule-based draft classifier. Do not claim live statutory integrations or unrestricted offline navigation from this run.
- Product source was not changed for the dry-run/media. Earlier features remain deployed on Oracle at 46a394067dfe2777b0ead8860018fab5f256029e with 17 migrations.
