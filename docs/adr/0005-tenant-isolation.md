# Application-level tenant isolation

Every query uses `factoryId` from the authenticated session, never from the client body, query string, or header. Cross-tenant tests must fail closed at the application layer.

PostgreSQL RLS is `ENABLE` (not `FORCE`) on parent tables that have `factory_id`. That does **not** give dual isolation in this release:

- The table-owning application role is exempt from ENABLE-only policies.
- `PrismaService.withFactory` has no request call sites, so `app.current_factory_id` is never set on live queries.
- Child tables (order lines, packing lines, day logs, opening lines) have no `factory_id` and no parent-join policies.

Isolation today is application `WHERE factory_id = session.factoryId` only. A restricted read-only database role is not safe until RLS is measured against Postgres 16 with a non-owner role (FORCE, or a separate NOBYPASSRLS login). Do not claim dual isolation until that measurement exists.
