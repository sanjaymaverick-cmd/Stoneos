# Snapshot Copilot on the CEO dashboard

The AI CEO Dashboard lives in StoneOS `/dashboard`, not Excel.

- KPIs are ledger aggregates for the session factory.
- Copilot (`POST /api/v1/reports/ceo/ask`) answers from that snapshot plus domain rules.
- No external LLM. No ad-hoc SQL. No localStorage as factory truth.
- `EXECUTIVE_ROLES` (owner, auditor) see the board and Copilot. `COMMERCIAL_READ_ROLES`
  (adds manager, accountant, admin) see books, AR and GST. Everyone else sees shop-floor
  counts only. `/books/copilot/propose` is owner and accountant: it is a write, so the
  read-only auditor is excluded.
