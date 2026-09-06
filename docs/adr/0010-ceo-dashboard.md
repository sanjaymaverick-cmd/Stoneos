# CEO dashboard is rule-based factory truth

The Vedam AI CEO Dashboard (Excel production/sales brief) is folded into StoneOS as `/dashboard` plus `GET /api/v1/reports/ceo`.

Exceptions and ratios are **deterministic domain rules** (`packages/domain/src/ceo-brief.ts`). No model calls, no Copilot, no grounded RAG. ADR 0009 still holds.

Commercial fields (invoice, payment, AR, expenses) are limited to `CEO_ROLES`. Shop-floor counts stay on `ANY_AUTHENTICATED_ROLE`.

UI personalization in localStorage is not factory truth.
