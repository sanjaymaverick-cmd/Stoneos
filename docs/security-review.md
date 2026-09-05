# Security and tenant-isolation review

## Controls present in this rebuild

- No Clerk, no public signup, no demo auth bypass.
- scrypt password hashes; plaintext never stored.
- Opaque session hashes; revoke deletes rows.
- Forced temporary-password change blocks other writes.
- Owner-only owner management; self-demotion forbidden.
- Login rate limit separate from general limit.
- Audit events on auth, user admin, inventory, and production writes.
- `factoryId` taken from the session, never the client body.
- Cross-factory raw-block listing is tested.
- Object storage port defaults to local disk; S3/OCI is private buckets only.
- Production process refuses placeholder `SESSION_SECRET`.

## Residual risks

- In-memory rate limits are per process. Login is 10/min per IP. Anonymous traffic is 120/min per IP. Authenticated traffic is 600/min per IP+token prefix. Multi-instance deploys need Redis or API gateway throttling.
- RLS is enabled in the migration for tenant tables; the table-owning app role is exempt unless FORCE is used. FORCE is avoided because managed Postgres often lacks BYPASSRLS. A restricted role is the Copilot path later.
- Electron/Capacitor shells load a remote origin; treat that origin as the trust boundary.
- Trivy and `npm audit` must be re-run on every release; counts in the readiness doc are only valid for the run that produced them.
