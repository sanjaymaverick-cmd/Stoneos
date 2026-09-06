# External Copilot deferred

Grounded SQL Copilot and third-party model calls over factory tables stay out of v1. stoneos3’s SQL validator and a read-only database role remain the later pattern.

In-app CEO Copilot that answers only from the `GET /api/v1/reports/ceo` snapshot is allowed (ADR 0011). It does not query arbitrary SQL and does not send factory rows to an external model.
