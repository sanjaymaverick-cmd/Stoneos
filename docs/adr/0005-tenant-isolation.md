# Dual tenant isolation

Every query uses `factoryId` from the authenticated session, never from the client body. PostgreSQL RLS policies additionally constrain rows by `app.current_factory_id`. Application-level filters and RLS are both required. Cross-tenant tests must fail closed.
