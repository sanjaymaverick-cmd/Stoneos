# Grok prompt: live dry company run (FY 2025-26) with role agents

Copy everything below the line into Grok. Supply the owner password separately, as the
environment variable `STONEOS_OWNER_PASSWORD`. Never paste it into the prompt.

---

You are running a **real-company dry run** of StoneOS, a granite factory app, on its live deployment.
Then you record every bug and UI/UX problem you find, each traced to the code that causes it.
Work as a coordinator that runs **four agents**: Owner, Manager, Supervisor, and UI/UX.

## 1. Context

- Repo: `D:\work Dir\stoneOS` (GitHub `sanjaymaverick-cmd/Stoneos`). Read `AGENTS.md` and `docs/handoff.md` first.
- Live site: `http://193.122.159.175`.
  - Web login: `/login`.
  - API: `/api/v1/...`. OpenAPI: `/api/docs`.
  - `/health/*` is **not** exposed at this origin (404). That is expected.
- The data on this server is **mock data**. The database will be wiped after this run, so creating transactions is fine.
- Stack: NestJS API `apps/api`, Next 15 PWA `apps/web`, Postgres, shared roles in `packages/contracts/src/roles.ts`, web nav policy in `apps/web/lib/routePolicy.ts`.
- Volume engine: `.grok/skills/factory-year-run/scripts/volume-run.mjs`. It is on branch `claude/volume-dry-run` (PR #12). If that PR is not merged yet, check out that branch.

## 2. Credentials and account rules

- **Owner login:**
  - Username `owner`; the password is in `$STONEOS_OWNER_PASSWORD`.
  - Never print it, log it, write it to a file, put it in a URL, or commit it.
- **You generate every other login.** Only the owner can create accounts.
  - Usernames: `grok.<role>` (for example `grok.manager`).
  - Create one for each of: manager, admin, supervisor, operator, inventory, sales, accountant, auditor. The volume run needs every role, even the ones without their own agent.
  - New accounts get a temporary password and must change it on first login. Set a random password of at least 16 characters.
- **Store the generated logins** only in `var/grok-dry-run/credentials.json`. `var/` is gitignored. Never put passwords in reports or chat.
- **Lockout:** 10 wrong passwords lock an account, and 5 more suspend it. If **two logins in a row fail**, stop and report; do not retry.
- **Rate limits:** login is limited to 10 per minute per IP. Authenticated requests are limited to 600 per minute per IP plus token. Stay under 540 per minute per token. On HTTP 429, wait 65 seconds.
- **Never:**
  - change the owner's password, revoke the owner, or demote the owner;
  - touch accounts that are not `grok.*` or `dry.*`;
  - run `terraform apply`;
  - push to `main` or deploy.

## 3. Business shape to simulate

- **Financial year:** 1 April 2025 to 31 March 2026 (Indian FY). Working days are Monday to Saturday. The operational day starts at 07:00 IST.
- **Production:** 2–3 raw blocks a day, each 17–23 tons. They are cut into slabs, then polished. Target **4,000–5,000 sqft of good slabs per working day**.
- **Sales:** **90,000–100,000 sqft a month**, in truckloads of about 900–1,500 sqft.
  - Customers are both in-state and in other states, so invoices carry both CGST/SGST and IGST.
  - About 8% are cash sales with no invoice.
- **Collections:** about 55% paid in full on the day, about 30% half paid, about 15% on credit and collected about 30 days later. About 4% stay unpaid as doubtful.
- **Monthly:**
  - Electricity, maintenance, diesel, transport and consumables expenses.
  - Crew attendance.
  - Wage sheet: the accountant drafts it, the manager confirms it, the accountant pays it.
  - One customer return with a credit note.
  - A cash drawer lock.
  - Month-end reports.

## 4. Phase 1: Owner agent sets up and drives the volume

Run this first, alone.

1. Log in as the owner. If `mustChangePassword` is true, stop and ask the human. Do not rotate the owner's password.
2. Run the volume engine for the full FY. It provisions the logins, runs about 20 role-boundary checks, and simulates every day:

   ```bash
   STONEOS_API_URL=http://193.122.159.175 START_MONTH=2025-04 MONTHS=12 RUN_PREFIX=grok \
     node .grok/skills/factory-year-run/scripts/volume-run.mjs
   ```

   - It writes `var/volume-run-report.{json,md}` after every month and the logins to `var/dry-run-credentials.json`. Move that credentials file to `var/grok-dry-run/credentials.json`.
   - Watch the per-day progress line. Abort if unexpected failures grow by more than 20 in one simulated week, or if the server stops responding. Then report what you saw.
3. While the engine runs, **do not** run the other agents' write-heavy steps. Reading screens is fine.
4. After the engine finishes, do the owner-only work by hand, in the browser and through the API:
   - **User lifecycle:** create a spare `grok.temp` operator, reset its password, revoke it, reactivate it, and change its role to inventory.
     - Confirm that the old password stops working after the reset.
     - Confirm that a revoked user cannot log in.
     - Confirm that reactivation issues a new one-time password.
   - **GST profile:** check it. If the engine set the dummy `08AABCD1234E1Z5`, note that.
   - **Opening stock count:** if the factory was not LIVE, check that the person who entered the count could not approve it.
   - **CEO board** (`/dashboard` executive view), audit log, CSV exports (blocks, slabs).
5. **Year-end reconciliation** is the core of the owner's report. Each check is pass or fail, with the numbers:
   - Trial balance totals: debits equal credits.
   - For each month, GSTR-1 (`/api/v1/gst/gstr1?month=YYYY-MM`) taxable value and tax match the sum of that month's invoices.
   - Outstanding receivables (`/api/v1/books/outstanding`) equal invoiced − paid − credit notes. Check this per customer and in total.
   - Invoice numbers are a continuous sequence with no gaps or duplicates (`INV-YYYY-NNNNN`, FY-based). Note which FY they landed in.
   - Stock: produced − sold − returned = in-stock slab count (`/api/v1/inventory/slabs`). Nothing is stuck as `reserved` after dispatch.
   - Recovery ratio (`/api/v1/recovery-ratio`) is plausible against 105 sqft per ton.
   - DPR (daily production report) totals for the year match the slabs actually cut.
   - The cash drawer (rokad) closes at a value that matches cash sales and cash payments.
   - **Known limitation (do not log it as a bug; summarise it once as a product gap):** the API takes no date for block receipt, cutting, polishing, dispatch or invoices, so those are stamped with the server's run date.

## 5. Phase 2: run these three agents in parallel, on the data Phase 1 created

Each agent logs in as its own `grok.<role>` user, using the web app in a real browser (Playwright or similar) **and** the API.
Each one samples at least 10 different simulated days across the FY and enters some real work by hand through the UI. For example, the Supervisor agent cuts and polishes one block end to end.

### Manager agent (`grok.manager`)

- **Daily running:**
  - Production overview and maintenance alerts.
  - Sales orders, quotations, outstanding receivables, party statements, books.
  - Expenses review.
  - Tally day-book import (upload a small valid XML).
  - Muster sheets: confirm one drafted by the accountant.
  - Approve an opening count, if one is pending.
- **Must be refused (expect 403, or the nav item hidden):**
  - creating users or assigning roles;
  - the owner's CEO board;
  - granting the owner role;
  - administering another manager;
  - confirming a wage sheet the manager drafted themselves.
- **Allowed:** resetting a supervisor-or-below password. Confirm it works.

### Supervisor agent (`grok.supervisor`)

- **Shop floor through the UI:** receive a block, start cutting, add a day log, complete it with good and damaged counts, polish, then check that the slabs show in finished stock.
- **Also:** pack and dispatch an order; attendance for the crew; maintenance jobs; consumables; upload a file; machine logs; daily production report (DPR).
- **Must be refused:** users, trial balance, Tally import, CEO board, wage pay, audit log.

### UI/UX agent (logs in as owner, `grok.manager` and `grok.supervisor` in turn; also `grok.operator` and `grok.auditor` for hidden-nav checks)

- Visit **every route** in `apps/web/lib/routePolicy.ts`: `/dashboard /production /inventory /sales /expenses /books /intake /muster /maintenance /consumables /files /recovery-ratio /tally /admin/users /admin/audit /setup/opening-inventory`.
- Do it at **1280×800 and 390×844**, as each role.
- Click, type and submit; a screenshot alone is not enough.
- **With a full year of data loaded, check:**
  - list and table performance, and pagination or virtualisation;
  - horizontal overflow on mobile;
  - truncated numbers;
  - Indian number formatting (lakh and crore, ₹);
  - dates shown in IST, DD-MM-YYYY;
  - empty, loading and error states;
  - form validation messages;
  - double-submit protection;
  - touch-target size;
  - contrast;
  - keyboard focus;
  - the offline/sync status indicator;
  - nav items hidden for roles that cannot use them, and what a deep link to a hidden route shows.
- **For each issue, find the component that causes it** under `apps/web/` (file:line) and propose a concrete fix (CSS, component change, or copy).
- Keep **defects** (broken, wrong, inaccessible) separate from **design suggestions**.

## 6. Recording bugs (all agents)

Append to `var/grok-dry-run/bugs.md`. Each bug gets one entry in this format:

```
### BUG-<n>: <one-line title>
- Agent / role: Supervisor / grok.supervisor
- Severity: P0 data loss or wrong money/stock/tax · P1 flow blocked · P2 wrong but workaround · P3 cosmetic
- Where: web route or API method + path
- Steps to reproduce: numbered, with the input values used
- Expected vs actual:
- Evidence: HTTP status, response excerpt (≤ 300 chars), screenshot path. Never include tokens or passwords.
- Root cause in code: file:line and a one-paragraph explanation, from reading the repo
- Proposed fix: specific change, plus the test that would catch it
- Status: proven (reproduced twice) / partial / unconfirmed
```

Rules:
- An expected 403 or 401 on a forbidden action is a **pass**, not a bug. Record it in the role-check table instead.
- A 403 on an action the role is supposed to be able to do **is** a bug.
- Any 5xx is a bug.
- Any mismatch in money, stock or tax is at least P1.
- Remove duplicates: one entry per root cause, listing every place it shows up.
- Do not claim something works because a page loads. Classify each module as **proven**, **partial** or **failed**, based on HTTP or browser evidence.

## 7. Code fixes

- Do not deploy, and do not push to `main`.
- If the human asks for fixes, put them on branch `grok/dry-run-fixes`, one commit per bug. Include tests, run `npm test`, and open a pull request.
- Otherwise, stop at the proposed fix.

## 8. Deliverables

In `var/grok-dry-run/`:

| File | Content |
|---|---|
| `owner.md` | Setup, user lifecycle, year-end reconciliation table with numbers |
| `manager.md` | Flows tried, role-check table, findings |
| `supervisor.md` | Flows tried, role-check table, findings |
| `uiux.md` | Route × role × viewport matrix (proven / partial / failed), defects, design suggestions |
| `bugs.md` | Consolidated bug list, sorted by severity |
| `summary.md` | One page: volumes achieved per month (sqft produced, sqft sold, invoices, collections), counts of P0–P3 bugs, top 10 fixes in priority order, product gaps |

End with a short chat summary: totals, the P0 and P1 bugs, and the path to `summary.md`.
