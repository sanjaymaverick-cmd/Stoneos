# Latest release — finished purchases and regular GST, 4 October 2026

PR #34 merged and deployed: https://github.com/sanjaymaverick-cmd/Stoneos/pull/34
Oracle main commit: 8ed71d518f2ff689240fe7dcdb03fa9aff827867.
Live purchase workspace: https://stoneos.duckdns.org/inventory?view=finished
GST balances: https://stoneos.duckdns.org/books/gst

The 14 rough-block varieties and 13 purchased slab/countertop varieties supplied by the owner are available; custom and historical varieties remain usable. Purchased finished pieces go straight to FINISHED_STOCK without a raw block, cutting or polishing entry. One same-size lot is entered per receipt; for a bill spanning several lots enter only each lot's share of goods/transport values. Review and confirm saves stock, goods/transport bills, purchase input GST and optional cash/bank/UPI payments together. Separate transport supplier and invoice are supported. Finished-goods landed cost is goods plus inward transport before GST, with exact paise allocation per piece and no royalty. Existing slab sales, supplier reports/payment modes/dues and purchased-stock ageing/valuation include these records.

Block costs now allow charged GST with a registered supplier and cash/bank/UPI modes; this supersedes the older no-GST-only limitation below. Full paid amount must equal taxable expense plus GST. Block allocation excludes GST. Rough-block purchase GST rate is editable from the actual bill; the UI requires supplier GSTIN for charged GST. GST monthly display shows purchase input and sales output per tax head. Final statutory credit eligibility, prior-period carry and cross-head utilization still require reconciliation before filing. Reverse-charge bills require separate review; statutory adapters remain test mode.

Additive migration 20261004180000_finished_purchases is deployed (19 total): finished_purchase table plus nullable slab receipt and purchase-cost fields. No new voucher enum value, preserving previous-code compatibility. Do not drop added data on rollback; historical costs remain unknown rather than invented. Purchased stock is valued as a current snapshot; no new COGS lifecycle was added. Individual slab sales work with purchased pieces; existing raw-block lot sales remain their own workflow.

Verification: 163 API tests and 20 web tests passed, production web build passed, all five CI gates passed. Isolated desktop/phone tests proved direct stock, catalogs, reviewed purchase, separate interstate transport GST, exact costs, lost-response retry with no duplicate purchase, sales visibility, GST table and purchased-stock analytics. Additional browser tests proved a ₹1,000 block expense plus ₹180 GST saves a ₹1,180 bank payment and ₹1,000 allocation. No runtime errors or page overflow in the finished workflow.

Oracle build/migrate/replace all returned zero. API healthy; deployed feature assets and anonymous endpoint denial verified. Complete existing business-table fingerprints and owner-login fingerprint match the private fresh predeploy baseline. No production test transactions; finished_purchase table remains empty. Temporary container verification file was removed. Release summary: ORACLE-FINISHED-RELEASE-2026-10-04.json. Local evidence: work/sell-reports/var/finished-evidence/ and prior API/web logs. Source handoff: docs/handoff-2026-10-04.md on origin/main.

Continue from origin/main. Offsite backups remain deferred; OpenAI key is still unconfigured. Preserve all live records/credentials. Do not reuse prior cleanup authorization. Older notes follow and are superseded where stated above.

---

# Latest release — Yard and Money unified

4 October 2026: PR #33 merged and deployed to Oracle. Verified running commit: 2c4740bd8a26d5e3f681912e8c3f07d11fc70d08. This supersedes the deployed commit in older sections below. Active checkout work/sell-reports is clean at this origin/main release.

Yard → Block costs owns block-cost review, per-ton rates, new paid expense entry, existing-expense links and source history. Each Yard block has Review costs. Money has a searchable full register showing block, component and remaining pre-GST amount, with links back to Yard. The separate allocation form is removed. The owner selects the block first and reviews before confirmation. A new expense, balanced posting and allocation commit atomically; retries reuse one operation. Existing-expense linking posts no duplicate payment and cannot exceed the remaining net cost. No-GST block expense entry only; previously recorded GST expense net amounts remain supported by existing-expense links. No new migrations.

Evidence: 160 API tests, 20 web tests, production build, desktop/phone isolated workflow checks including a deliberately lost POST reply and repeat-safe retry, direct block entry, partial allocations, fully allocated exclusion, rate switching and no overflow/runtime errors. All five PR CI gates passed. Oracle build/migrate/replace returned zero; API healthy, 18 migrations, public Yard/Money updated feature assets verified, protected analytics returns 401 unauthenticated. Production table fingerprints and owner login match the private pre-deploy baseline. Zero production test writes. Temporary verification file removed.

Local ignored evidence: work/sell-reports/var/yard-api-tests.log, var/yard-web-build.log, var/yard-evidence/. Release summary: ORACLE-YARD-RELEASE-2026-10-04.json.

OpenAI key remains unconfigured; statutory adapters stay test mode. Offsite backup work remains deferred. Do not reuse the old cleanup authorisation for new production deletions. Preserve all live records and credentials. Older handoff follows.

---

# StoneOS continuation — 4 October 2026
Read this before older handoffs. User authorised the remaining product improvements and deployment, deferring offsite backups. OpenAI is chosen. Statutory integrations stay test-only until credentials and real adapters exist. Preserve all production records and owner credentials; earlier cleanup authorisation does not apply to this release.

## Delivered changes
- Offline navigation never substitutes another screen; warming is acknowledged only when every route/asset succeeds.
- Maintenance rescheduling, date/title validation, repeat-safe completion; consumable receipt/usage history with atomic nonnegative stock.
- StoneOS branding. Year-run script refuses nonlocal origins and requires STONEOS_ALLOW_DEMO_WRITES=yes; its staff roles match the current hierarchy.
- Owner Business insights under More (/analytics): dated sales/collections/expense comparison, dues ageing and follow-up promises, current stock ageing, block/variety margin, machine productivity/OEE inputs, pending dispatch promises, customer/supplier comparisons, monthly trends.
- Source-linked English/Hindi OpenAI answers, deterministic owner briefing/alerts, three-complete-month planning scenarios and editable supplier bill/delivery note drafts. Draft reviews do not post stock, payments or journals.
- Per user clarification, block costs have block price/ton, royalty/ton and transport rent/ton. Stone price reconciles to frozen billed plus cash price. Royalty/transport estimates are replaced by tagged actual expense allocations without double counting; incomplete allocations prevent cost confirmation. New allocations or rate/cash-cost changes reopen cost confirmation.

## Boundaries and setup
Business insights and provider settings are owner-only. OpenAI settings accept a key securely in the product; server encryption uses SESSION_SECRET (do not rotate without re-entering saved keys). No real provider credential was supplied in this task. OPENAI_API_KEY may be configured server-side; STONEOS_OPENAI_MODEL defaults to gpt-4.1-mini. Requests use the Responses API, strict structured output, store:false, timeouts and rate limits. Settings/AI/documents bypass the offline queue. API results never expose keys.
Schema migration 20261004120000_analytics_inputs is additive (18 total migrations). Historical unknown inputs remain null, never backfilled with invented values. Rollback code without dropping these columns/tables or document enum values.
Sales and collections follow document dates; stock/block cost/margin are current cumulative snapshots. Customer margin is an area-based cumulative estimate, not period profit. OEE is calculated only from configured standards and recorded days with quality output; polishing lacks quality loss records and shows no OEE. Planning low/high values are historical scenarios, not promises or confidence intervals. Targets are owner choices.
Supplier bills and delivery notes can be reopened from the Analytics document selector. Use manual entry after review. Existing intake confirmation rejects these kinds.

## Verification
159 API tests passed on disposable PostgreSQL including the new migration, per-ton reconciliation, isolation, encrypted settings, review-only drafts, OEE, monetary allocations and OpenAI source validation. Production web build passed. Isolated desktop (1280×800) and mobile (390×844) checks passed with no page errors or body overflow; changed workflow screens rendered. Real provider calls remain unverified until a key is configured.
Local evidence: var/analytics-api-tests.log, var/analytics-web-build.log, var/analytics-evidence/ (ignored). Demo database is stoneos_dry_run on loopback 55435; API 4007/web 3008. Never run testing writes on stoneos.duckdns.org.
Oracle runbook: docs/runbooks/oci-deploy-handoff.md. Offsite backup configuration/timer remains deferred. The existing local predeploy backup remains part of deployment.
## Verified release — 4 October 2026
PR #32 merged: https://github.com/sanjaymaverick-cmd/Stoneos/pull/32
Oracle is running main commit d9720a9d66135cb2d28310ae6765f32a41f235a8. Deployment exited 0: build, migration and container replacement succeeded. All 18 migrations are applied. Internal readiness confirms database reachable. The public analytics page returns HTTP 200 and its feature asset is present; the analytics API correctly returns 401 without authentication. Direct read-only factory-scoped analytics validation passed.
Private before/after database fingerprints matched for invoices, payments, cash sales, expenses, raw blocks, sales orders and the owner login. No production mock transactions or credential changes were made.
All five GitHub release gates passed: quality, images, security, restore on a fresh runner and terraform validation. Local 159 API and 20 web tests passed; production builds and isolated desktop/mobile and worker network-fault checks passed.
OpenAI is implemented but its key is not yet configured on Oracle. The owner can enter it at More → Business insights → Targets & OpenAI settings. Do not ask for secrets in chat. Real model calls remain unverified until configured. Statutory integrations remain test mode. Offsite backups and their timer are still deferred.
Local working checkout is clean on codex/kpi-analytics; origin/main contains the merged release. Original D:/work Dir/stoneOS was preserved. Start future work from latest origin/main and inspect any user's newer changes before modifying files.


Release review: the deploy script now builds and applies additive migrations before replacing the API/web containers. A migration failure leaves the old service running. The current release is PR #32. All 20 web regressions pass; the isolated offline check combines browser offline emulation with an explicit worker network fault.

## Local project location — 5 October 2026
The user-designated project folder is D:\work Dir\stoneOS. All tracked files were updated by fast-forward to deployed main 8ed71d518f2ff689240fe7dcdb03fa9aff827867. Latest handoffs, release records, validation logs, browser evidence and demo scripts are saved here. Use this folder for future project work. Existing local files were preserved. The isolated demo PostgreSQL data directory remains in the earlier Codex workspace; demo scripts must not be run against production or assumed to have a restored local demo database. Source files match origin/main.
