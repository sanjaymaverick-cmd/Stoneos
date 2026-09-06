-- Opening SoD: who entered each line, not who clicked Start.
ALTER TABLE "opening_inventory_line" ADD COLUMN "entered_by_id" TEXT NOT NULL DEFAULT '';

UPDATE "opening_inventory_line" AS l
SET "entered_by_id" = s."entered_by_id"
FROM "opening_inventory_snapshot" AS s
WHERE l."snapshot_id" = s."id" AND l."entered_by_id" = '';

ALTER TABLE "opening_inventory_line" ALTER COLUMN "entered_by_id" DROP DEFAULT;

-- Factory-scoped IST FY document numbers (April–March). Gaps from rolled-back
-- transactions are not reused; uniqueness is (factory_id, number).
CREATE TABLE "document_sequence" (
    "factory_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "next_number" INTEGER NOT NULL,

    CONSTRAINT "document_sequence_pkey" PRIMARY KEY ("factory_id","kind","fiscal_year")
);

ALTER TABLE "document_sequence" ADD CONSTRAINT "document_sequence_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reason-coded AR credit for invoiced returns.
CREATE TABLE "credit_note" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "customer_return_id" TEXT,
    "credit_note_number" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "credit_note_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_note_customer_return_id_key" ON "credit_note"("customer_return_id");
CREATE UNIQUE INDEX "credit_note_factory_id_credit_note_number_key" ON "credit_note"("factory_id", "credit_note_number");
CREATE UNIQUE INDEX "credit_note_factory_id_idempotency_key_key" ON "credit_note"("factory_id", "idempotency_key");

ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_customer_return_id_fkey" FOREIGN KEY ("customer_return_id") REFERENCES "customer_return"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Concurrent pay cannot insert past remaining invoice AR even if FOR UPDATE is skipped.
CREATE OR REPLACE FUNCTION payment_cannot_exceed_invoice() RETURNS trigger AS $$
DECLARE
  inv_amount NUMERIC;
  paid NUMERIC;
  credited NUMERIC;
BEGIN
  SELECT amount INTO inv_amount FROM invoice WHERE id = NEW.invoice_id FOR UPDATE;
  IF inv_amount IS NULL THEN
    RAISE EXCEPTION 'Invoice not found for payment'
      USING ERRCODE = '23503';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO paid FROM payment WHERE invoice_id = NEW.invoice_id;
  SELECT COALESCE(SUM(amount), 0) INTO credited FROM credit_note WHERE invoice_id = NEW.invoice_id;
  IF paid > inv_amount - credited + 0.001 THEN
    RAISE EXCEPTION 'Payment exceeds invoice amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER payment_amount_guard
AFTER INSERT OR UPDATE ON payment
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION payment_cannot_exceed_invoice();
