# Reference repository comparison

Audit date: 2026-09-05. Repositories were inspected read-only.

| Area | ston3gpt main | stoneos3 main | stoneos3 pwa-mobile | StoneOS rebuild |
|---|---|---|---|---|
| Auth | Email + hashed sessions | Clerk + public signup | Username + JWT | Username + opaque hashed sessions |
| Bootstrap | Script, not in prod image | Clerk grant | Script, not in prod image | CLI inside API image, one-time lock |
| Roles inventory/sales | In enum | Constants only | Constants only | In enum |
| Opening count | Implemented | Implemented | Implemented | Reimplemented |
| Goods receipt | Implemented | Missing | Missing | Reimplemented |
| Cutting/polishing | Implemented | Implemented | Implemented | Reimplemented |
| Quotations / packing | Missing | Missing | Missing | Added |
| Offline write queue | Explicitly rejected | Missing | Explicitly rejected | Outbox + 409 conflicts |
| Terraform OCI/AWS | Missing | VM runbook only | Missing | Modules added |
| OpenAPI | Missing | Missing | Missing | `/api/docs` |
| Copilot | localStorage UI | SQL+RLS, never live-tested | Same | Deferred (ADR 0009) |

Security defects not inherited: Clerk, demo auth bypass, secrets in migrations, CI Clerk leftover, in-place migration edits.
