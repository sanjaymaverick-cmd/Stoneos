# Snapshot Copilot on the CEO dashboard

The AI CEO Dashboard lives in StoneOS `/dashboard`, not Excel.

- KPIs are ledger aggregates for the session factory.
- Copilot (`POST /api/v1/reports/ceo/ask`) answers from that snapshot plus domain rules.
- No external LLM. No ad-hoc SQL. No localStorage as factory truth.
- `CEO_ROLES` see money and Copilot. Other roles see shop-floor counts only.
