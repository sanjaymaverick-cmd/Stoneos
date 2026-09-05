-- Tenant FK and RLS for customer returns (column already existed).
ALTER TABLE "customer_return"
  ADD CONSTRAINT "customer_return_factory_id_fkey"
  FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_return" ENABLE ROW LEVEL SECURITY;
CREATE POLICY factory_isolation ON "customer_return"
  USING (factory_id = NULLIF(current_setting('app.current_factory_id', true), ''));
