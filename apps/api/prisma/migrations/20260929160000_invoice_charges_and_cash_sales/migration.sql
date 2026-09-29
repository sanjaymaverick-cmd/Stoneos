-- Ancillary charges on an invoice, and counter sales settled in cash with no invoice.

CREATE TYPE "BillingMode" AS ENUM ('gst_invoice', 'cash_unbilled');

ALTER TABLE "sales_order"
  ADD COLUMN "billing_mode" "BillingMode" NOT NULL DEFAULT 'gst_invoice';

-- Charges billed outside the taxable value. Added to the payable but never taxed.
ALTER TABLE "invoice" ADD COLUMN "exempt_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Packaging, demurrage, labour, handling. Section 15 makes these part of the
-- transaction value, so they default to taxed with the principal supply.
CREATE TABLE "invoice_charge" (
  "id"         TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "amount"     DECIMAL(14,2) NOT NULL,
  "taxable"    BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_charge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_charge_invoice_id_idx" ON "invoice_charge"("invoice_id");
ALTER TABLE "invoice_charge"
  ADD CONSTRAINT "invoice_charge_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A cash counter sale. The stock movement and the cash are recorded; there is no
-- invoice and no GST document, so nothing reaches GSTR-1.
CREATE TABLE "cash_sale" (
  "id"             TEXT NOT NULL,
  "factory_id"     TEXT NOT NULL,
  "sales_order_id" TEXT NOT NULL,
  "buyer_name"     TEXT,
  "amount"         DECIMAL(14,2) NOT NULL,
  "sale_date"      DATE NOT NULL,
  "note"           TEXT,
  "client_op_id"   TEXT NOT NULL,
  "recorded_by"    TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_sale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cash_sale_sales_order_id_key" ON "cash_sale"("sales_order_id");
CREATE UNIQUE INDEX "cash_sale_factory_id_client_op_id_key" ON "cash_sale"("factory_id", "client_op_id");
CREATE INDEX "cash_sale_factory_id_sale_date_idx" ON "cash_sale"("factory_id", "sale_date");
ALTER TABLE "cash_sale"
  ADD CONSTRAINT "cash_sale_factory_id_fkey"
  FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_sale"
  ADD CONSTRAINT "cash_sale_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unbilled revenue is kept on its own ledger so it is never mistaken for invoiced
-- turnover in the trial balance or reconciled against a GST return.
ALTER TABLE "cash_sale" ENABLE ROW LEVEL SECURITY;
CREATE POLICY factory_isolation ON "cash_sale"
  USING (factory_id = NULLIF(current_setting('app.current_factory_id', true), ''));

ALTER TYPE "VoucherSource" ADD VALUE IF NOT EXISTS 'cash_sale';
