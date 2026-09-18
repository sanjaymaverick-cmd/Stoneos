-- Sister yards are ordinary customers/suppliers. No special in-app interfactory ledger.

DROP TRIGGER IF EXISTS settlement_amount_guard ON interfactory_settlement;
DROP FUNCTION IF EXISTS settlement_cannot_exceed_payable();

DROP TABLE IF EXISTS "interfactory_settlement";
DROP TABLE IF EXISTS "interfactory_payable";
DROP TABLE IF EXISTS "interfactory_link";

DROP INDEX IF EXISTS "customer_factory_id_counterparty_factory_id_key";
ALTER TABLE "customer" DROP COLUMN IF EXISTS "counterparty_factory_id";
ALTER TABLE "invoice" DROP COLUMN IF EXISTS "counterparty_factory_id";
