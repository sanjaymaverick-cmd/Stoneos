---
name: ui-ux-modules
description: >
  Walk every StoneOS web module for UI/UX at desktop and mobile, including empty
  and error states and role-hidden nav. Use for a UI UX agent, design test of every
  function module, or /ui-ux-modules.
---

# UI/UX module walk

App origin: `http://localhost:3000`. Login `owner` / current owner password.

## Routes (from `apps/web/lib/routePolicy.ts`)

Login `/login`, password `/account/password`, then every `href` in `routes`.

## Steps

1. Confirm web is up. Start it if not.
2. For **desktop 1280×800** and **mobile 390×844**, as owner: open each route, wait for data or empty table, try the primary form if present.
3. As **operator**: confirm Team, Tally, Sales, Expenses, Audit are absent from nav; visiting `/admin/users` does not expose a working provision form.
4. As **auditor**: Dashboard and Audit visible; Production write forms not in nav.
5. Check sticky sync bar (Synced / queued / Offline), 44px tap targets on nav, form labels wrapping inputs, tables not overflowing unusably on mobile, error text using `.error`.

Write `var/ui-ux-module-review.md`: module, viewport, result, notes. Separate **blockers** from **suggestions**.

Done when every route in `routePolicy.ts` plus login and password has a row for both viewports.
