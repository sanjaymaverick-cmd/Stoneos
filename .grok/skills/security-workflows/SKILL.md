---
name: security-workflows
description: >
  Verify StoneOS workflow security: no public signup, opaque sessions, RBAC denials,
  tenant-scoped writes, temp-password lock, audit events. Use for a security agent,
  workflow security review, or /security-workflows.
---

# Workflow security

Read `docs/security-review.md` once, then **prove** each control against the live API.

## Checks (all required)

1. Unauthenticated `POST /api/v1/auth/login` with a bad password → 401. No signup route (`POST /api/v1/auth/signup` → 404).
2. Operator token cannot `POST /api/v1/admin/users` (403). Manager token cannot provision `role: owner` (403).
3. `factoryId` in a write body is ignored; records use the session factory. Try a forged id on `POST /api/v1/inventory/raw-blocks` and confirm the stored factory is the session's.
4. After login with a temp password, a non-password write is 403 until `POST /api/v1/auth/change-password`.
5. `POST /api/v1/auth/logout` then reuse the bearer token → 401.
6. Auditor can `GET /api/v1/reports/dashboard` and cannot `POST /api/v1/expenses`.
7. Confirm `docs/security-review.md` residual risks still match the code (`session.guard.ts`, `users.service.ts`, Prisma RLS in migrations).

Write `var/security-workflow-review.md` as a table: control, result (pass/fail), evidence (status + path), severity if fail.

Done when every check has a result row. Do not mark pass from source comments alone.
