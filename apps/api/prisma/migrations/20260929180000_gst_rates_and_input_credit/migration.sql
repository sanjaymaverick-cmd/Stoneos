-- Input tax credit. Purchases previously posted nothing at all: no payable, no stock
-- value, no recoverable tax. Rates are chosen per document from the statutory slabs,
-- because raw blocks (HSN 2516) are 5%, finished slabs (HSN 6802) are 18%, and
-- consumables sit on several.

-- Place of supply and the credit trail for a purchase.
ALTER TABLE "supplier" ADD COLUMN "state_code" TEXT;
ALTER TABLE "supplier" ADD COLUMN "gstin" TEXT;

ALTER TABLE "raw_block" ADD COLUMN "purchase_taxable"      DECIMAL(14,2);
ALTER TABLE "raw_block" ADD COLUMN "purchase_cgst"         DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "raw_block" ADD COLUMN "purchase_sgst"         DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "raw_block" ADD COLUMN "purchase_igst"         DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "raw_block" ADD COLUMN "purchase_gst_rate_pct" DECIMAL(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE "raw_block" ADD COLUMN "supplier_invoice_no"   TEXT;
ALTER TABLE "raw_block" ADD COLUMN "supplier_gstin"        TEXT;
ALTER TABLE "raw_block" ADD COLUMN "place_of_supply"       TEXT;

ALTER TABLE "expense" ADD COLUMN "taxable_amount" DECIMAL(14,2);
ALTER TABLE "expense" ADD COLUMN "cgst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "expense" ADD COLUMN "sgst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "expense" ADD COLUMN "igst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "expense" ADD COLUMN "gst_rate_pct"   DECIMAL(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE "expense" ADD COLUMN "supplier_gstin" TEXT;

-- Rows booked before this migration carry no tax split. Restate their whole value as
-- taxable with zero credit, so they read as un-credited rather than silently crediting
-- tax nobody recorded.
UPDATE "raw_block" SET "purchase_taxable" = COALESCE("actual_amount_paid", "invoiced_amount")
 WHERE "purchase_taxable" IS NULL;
UPDATE "expense" SET "taxable_amount" = "amount" WHERE "taxable_amount" IS NULL;

ALTER TYPE "VoucherType"   ADD VALUE IF NOT EXISTS 'purchase';
ALTER TYPE "VoucherSource" ADD VALUE IF NOT EXISTS 'block_purchase';
