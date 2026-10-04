# ADR 0019 — Owner analytics and OpenAI assistance

Accepted 4 October 2026 by explicit user request; supersedes earlier deferral of external AI in ADR 0009/0010 for these owner-only analytics and document draft endpoints.

Money and stock calculations remain deterministic application code. OpenAI receives a factory-scoped, bounded snapshot with approved source identifiers. It cannot run SQL, invoke mutations or confirm documents. Output is validated structured JSON; source references must exist in the supplied snapshot. Show provider errors as errors, never silently label rule-based text as AI. English/Hindi explanations are supported. Documents become reviewable drafts and require existing confirmation permissions.

Provider keys remain server-only and are encrypted at rest when configured through the owner screen; they are never returned, included in logs/audits, browser storage or source control. Calls use store:false, limited output and timeouts. Statutory integrations remain explicitly mock/test; environment variables alone do not imply a real filing. Offsite backups remain deferred by user.

Missing costs, due dates, planned runtime, ideal production rates and short history appear as incomplete data, not zeros or confident forecasts. Nullable input additions preserve historical financial amounts.
