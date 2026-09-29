# CEO dashboard is rule-based factory truth

The Vedam AI CEO Dashboard (Excel production/sales brief) is folded into StoneOS as `/dashboard` plus `GET /api/v1/reports/ceo`.

Exceptions and ratios are **deterministic domain rules** (`packages/domain/src/ceo-brief.ts`). No model calls, no Copilot, no grounded RAG. ADR 0009 still holds.

The board itself (`GET /reports/ceo`) and the Copilot ask are **`EXECUTIVE_ROLES`: owner
and auditor only**. A manager runs the plant and keeps every commercial permission below
— trial balance, party statements, outstanding AR, GST filing, stock exports, all on
`COMMERCIAL_READ_ROLES` — but the executive board is the owner's, and the auditor sees it
because read-only oversight is that role's purpose. Shop-floor counts
(`GET /reports/dashboard`) stay on `ANY_AUTHENTICATED_ROLE`, so `/dashboard` remains
everyone's landing page and simply renders fewer tiles.

UI personalization in localStorage is not factory truth.
