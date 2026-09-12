-- Dispatch, restore sister-plant trade, GST documents, muster.
-- COMMIT so PG can ADD enum values (not allowed mid-transaction). Do not BEGIN again:
-- Prisma will disconnect after the file; an open BEGIN would roll back the DDL.
COMMIT;
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'DISPATCH';
ALTER TYPE "VoucherSource" ADD VALUE IF NOT EXISTS 'muster_pay';
ALTER TYPE "VoucherSource" ADD VALUE IF NOT EXISTS 'interfactory_invoice';
ALTER TYPE "VoucherSource" ADD VALUE IF NOT EXISTS 'interfactory_settle';
ALTER TYPE "VoucherSource" ADD VALUE IF NOT EXISTS 'copilot_journal';
ALTER TYPE "IntakeKind" ADD VALUE IF NOT EXISTS 'journal';

ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "counterparty_factory_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "customer_factory_id_counterparty_factory_id_key" ON "customer"("factory_id", "counterparty_factory_id");

ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "counterparty_factory_id" TEXT;

CREATE TABLE IF NOT EXISTS "interfactory_link" (
    "id" TEXT NOT NULL,
    "factory_a_id" TEXT NOT NULL,
    "factory_b_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interfactory_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "interfactory_link_factory_a_id_factory_b_id_key" ON "interfactory_link"("factory_a_id", "factory_b_id");
CREATE UNIQUE INDEX IF NOT EXISTS "interfactory_link_pair" ON "interfactory_link" (LEAST("factory_a_id", "factory_b_id"), GREATEST("factory_a_id", "factory_b_id"));
ALTER TABLE "interfactory_link" DROP CONSTRAINT IF EXISTS "interfactory_link_factory_a_id_fkey";
ALTER TABLE "interfactory_link" ADD CONSTRAINT "interfactory_link_factory_a_id_fkey" FOREIGN KEY ("factory_a_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_link" DROP CONSTRAINT IF EXISTS "interfactory_link_factory_b_id_fkey";
ALTER TABLE "interfactory_link" ADD CONSTRAINT "interfactory_link_factory_b_id_fkey" FOREIGN KEY ("factory_b_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "interfactory_payable" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "interfactory_payable_source_invoice_id_key" ON "interfactory_payable"("source_invoice_id");
CREATE INDEX IF NOT EXISTS "interfactory_payable_factory_id_idx" ON "interfactory_payable"("factory_id");
ALTER TABLE "interfactory_payable" DROP CONSTRAINT IF EXISTS "interfactory_payable_factory_id_fkey";
ALTER TABLE "interfactory_payable" ADD CONSTRAINT "interfactory_payable_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_payable" DROP CONSTRAINT IF EXISTS "interfactory_payable_seller_factory_id_fkey";
ALTER TABLE "interfactory_payable" ADD CONSTRAINT "interfactory_payable_seller_factory_id_fkey" FOREIGN KEY ("seller_factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_payable" DROP CONSTRAINT IF EXISTS "interfactory_payable_source_invoice_id_fkey";
ALTER TABLE "interfactory_payable" ADD CONSTRAINT "interfactory_payable_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "interfactory_settlement" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "interfactory_settlement_factory_id_idempotency_key_key" ON "interfactory_settlement"("factory_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "interfactory_settlement_payable_id_idx" ON "interfactory_settlement"("payable_id");
ALTER TABLE "interfactory_settlement" DROP CONSTRAINT IF EXISTS "interfactory_settlement_factory_id_fkey";
ALTER TABLE "interfactory_settlement" ADD CONSTRAINT "interfactory_settlement_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interfactory_settlement" DROP CONSTRAINT IF EXISTS "interfactory_settlement_payable_id_fkey";
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

DROP TRIGGER IF EXISTS settlement_amount_guard ON interfactory_settlement;
CREATE CONSTRAINT TRIGGER settlement_amount_guard
AFTER INSERT OR UPDATE ON interfactory_settlement
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION settlement_cannot_exceed_payable();

CREATE TYPE "GstDocStatus" AS ENUM ('draft', 'mock', 'live', 'failed');
CREATE TYPE "WorkerKind" AS ENUM ('cutter', 'polisher', 'helper', 'driver', 'other');
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'half', 'ot');
CREATE TYPE "WageSheetStatus" AS ENUM ('draft', 'confirmed', 'paid');

CREATE TABLE "gst_profile" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "irp_sandbox" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gst_profile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gst_profile_factory_id_key" ON "gst_profile"("factory_id");
ALTER TABLE "gst_profile" ADD CONSTRAINT "gst_profile_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "e_invoice" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "credit_note_id" TEXT,
    "irn" TEXT NOT NULL,
    "ack_no" TEXT NOT NULL,
    "signed_qr" TEXT NOT NULL,
    "status" "GstDocStatus" NOT NULL DEFAULT 'mock',
    "source" TEXT NOT NULL DEFAULT 'mock',
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "e_invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "e_invoice_invoice_id_key" ON "e_invoice"("invoice_id");
CREATE UNIQUE INDEX "e_invoice_credit_note_id_key" ON "e_invoice"("credit_note_id");
CREATE INDEX "e_invoice_factory_id_idx" ON "e_invoice"("factory_id");
ALTER TABLE "e_invoice" ADD CONSTRAINT "e_invoice_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "e_invoice" ADD CONSTRAINT "e_invoice_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "e_invoice" ADD CONSTRAINT "e_invoice_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "e_way_bill" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "delivery_id" TEXT,
    "vehicle_id" TEXT,
    "ewb_no" TEXT NOT NULL,
    "distance_km" INTEGER NOT NULL DEFAULT 0,
    "from_gstin" TEXT,
    "to_gstin" TEXT,
    "from_pin" TEXT,
    "to_pin" TEXT,
    "status" "GstDocStatus" NOT NULL DEFAULT 'mock',
    "source" TEXT NOT NULL DEFAULT 'mock',
    "client_op_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "e_way_bill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "e_way_bill_factory_id_client_op_id_key" ON "e_way_bill"("factory_id", "client_op_id");
CREATE INDEX "e_way_bill_factory_id_idx" ON "e_way_bill"("factory_id");
ALTER TABLE "e_way_bill" ADD CONSTRAINT "e_way_bill_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "e_way_bill" ADD CONSTRAINT "e_way_bill_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "worker" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "kind" "WorkerKind" NOT NULL DEFAULT 'other',
    "daily_wage_minor" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "worker_factory_id_name_key_key" ON "worker"("factory_id", "name_key");
CREATE INDEX "worker_factory_id_idx" ON "worker"("factory_id");
ALTER TABLE "worker" ADD CONSTRAINT "worker_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "operational_date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "ot_hours" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_worker_id_operational_date_key" ON "attendance"("worker_id", "operational_date");
CREATE INDEX "attendance_factory_id_operational_date_idx" ON "attendance"("factory_id", "operational_date");
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wage_sheet" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "WageSheetStatus" NOT NULL DEFAULT 'draft',
    "client_op_id" TEXT NOT NULL,
    "proposed_by" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "paid_voucher_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wage_sheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wage_sheet_factory_id_client_op_id_key" ON "wage_sheet"("factory_id", "client_op_id");
CREATE INDEX "wage_sheet_factory_id_idx" ON "wage_sheet"("factory_id");
ALTER TABLE "wage_sheet" ADD CONSTRAINT "wage_sheet_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wage_line" (
    "id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "ot" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "amount_minor" INTEGER NOT NULL,
    CONSTRAINT "wage_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wage_line_sheet_id_worker_id_key" ON "wage_line"("sheet_id", "worker_id");
ALTER TABLE "wage_line" ADD CONSTRAINT "wage_line_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "wage_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wage_line" ADD CONSTRAINT "wage_line_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
