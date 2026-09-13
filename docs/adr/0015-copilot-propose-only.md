# ADR 0015 — Books copilot proposes drafts only

## Status

Accepted. 2026-09-12. Lifts ADR 0009 for this shape only.

## Decision

`POST /api/v1/books/copilot/propose` creates an `IntakeDraft` (`proposed`). The model (or the offline rule parser when `STONEOS_LLM_API_KEY` is unset) may classify rows. It must not call `expense.create`, `pay`, or `invoice`, must not emit SQL, and must not confirm its own draft. Confirm is the existing intake SoD path. CEO dashboard numbers stay rule-based (ADR 0010).
