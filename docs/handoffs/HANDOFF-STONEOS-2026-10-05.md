# StoneOS continuation — 5 October 2026

Read `docs/handoff.md`, then `docs/testing/company-year-results-2026-10-05.md`. The workspace is `D:\work Dir\stoneOS`.

The 12-month Oracle test-company run is complete: 1,161,600 sq ft manufactured, 1,056,000 sq ft gross sales, recovery of 110 sq ft per ton, and 105,640 sq ft remaining stock. All 2,229 vouchers balance; consumable balances are non-negative. Original company data and owner credentials were fingerprinted before and after and remained unchanged.

Test factory `5c183b6d-44b6-4e46-9744-3b705df6d38a` remains populated. Do not erase it without a separate cleanup request. The private simulation process is stopped; the public app is healthy. Deployed product commit remains `8ed71d5`; this testing work did not deploy product fixes.

## Findings and next work

- DPR counts 330 polished pieces instead of 110 finished pieces after three processing stages.
- All 528 saw-damage entries on unpaid credit blocks have zero cost despite positive purchase cost.
- Mobile overflow and extremely long registers are verified. Follow the ordered backlog in `docs/testing/ui-ux-improvements-2026-10-05.md`.
- The September-ending dues report differs from the ledger by ₹8,260 because a credit note uses its execution date. The all-dates report reconciles; review business-date handling.
- Nine separate role accounts were tested, but legacy role mappings do not establish nine distinct provisionable permission levels.
- OpenAI remains unconfigured; statutory integrations are mock/test mode. Offsite backups remain deferred.

## Evidence and reusable agents

Testing sources are in `scripts/testing`; ten reusable persona and UI/UX definitions are in `.grok/agents/company-year-*.md`. The execution guide is `docs/testing/company-year-testing.md`.

Raw reports, screenshots and downloaded Excel files are under ignored `var/company-year`. The private `fixture.json` contains generated synthetic credentials; never commit it or token files. The real owner login is unchanged.

Next work should address one bounded backlog item at a time, verify it against the retained test company, and preserve original business data. The audit is complete, but it is not an all-features pass.
