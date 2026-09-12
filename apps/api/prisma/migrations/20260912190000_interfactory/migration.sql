-- Sister-factory customers, AP mirror, and locked settlements.
ALTER TABLE "customer" ADD COLUMN "counterparty_factory_id" TEXT;
CREATE UNIQUE INDEX "customer_factory_id_counterparty_factory_id_key" ON "customer"("factory_id", "counterparty_factory_id");

ALTER TABLE "invoice" ADD COLUMN "counterparty_factory_id" TEXT;

CREATE TABLE "interfactory_link" (
    "id" TEXT NOT NULL,
    "factory_a_id" TEXT NOT NULL,
    "factory_b_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interfactory_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interfactory_link_factory_a_id_factory_b_id_key" ON "interfactory_link"("factory_a_id", "factory_b_id");
CREATE UNIQUE INDEX "interfactory_link_pair" ON "interfactory_link" (LEAST("factory_a_id", "factory_b_id"), GREATEST("factory_a_id", "factory_b_id"));

CREATE TABLE "interfactory_payable" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "seller_factory_id" TEXT NOT NULL,
    "source_invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "credited_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "interfactory_payable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interfactory_payable_source_invoice_id_key" ON "interfactory_payable"("source_invoice_id");
CREATE INDEX "interfactory_payable_factory_id_idx" ON "interfactory_payable"("factory_id");

ALTER TABLE "interfactory_payable" ADD CONSTRAINT "interfactory_payable_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_payable" ADD CONSTRAINT "interfactory_payable_seller_factory_id_fkey" FOREIGN KEY ("seller_factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_payable" ADD CONSTRAINT "interfactory_payable_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "interfactory_settlement" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "payable_id" TEXT NOT NULL,
    "seller_payment_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paid_at" DATE NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interfactory_settlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interfactory_settlement_factory_id_idempotency_key_key" ON "interfactory_settlement"("factory_id", "idempotency_key");
CREATE INDEX "interfactory_settlement_payable_id_idx" ON "interfactory_settlement"("payable_id");

ALTER TABLE "interfactory_settlement" ADD CONSTRAINT "interfactory_settlement_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_settlement" ADD CONSTRAINT "interfactory_settlement_payable_id_fkey" FOREIGN KEY ("payable_id") REFERENCES "interfactory_payable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION settlement_cannot_exceed_payable() RETURNS trigger AS $$
DECLARE
  bill NUMERIC;
  credited NUMERIC;
  settled NUMERIC;
BEGIN
  SELECT amount, credited_amount INTO bill, credited FROM interfactory_payable WHERE id = NEW.payable_id FOR UPDATE;
  IF bill IS NULL THEN
    RAISE EXCEPTION 'Payable not found for settlement' USING ERRCODE = '23503';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO settled FROM interfactory_settlement WHERE payable_id = NEW.payable_id;
  IF settled > bill - credited + 0.001 THEN
    RAISE EXCEPTION 'Settlement exceeds payable amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER settlement_amount_guard
AFTER INSERT OR UPDATE ON interfactory_settlement
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION settlement_cannot_exceed_payable();
