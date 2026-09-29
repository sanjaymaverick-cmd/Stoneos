-- GST is charged on top of the quoted rate, not carved out of it, and the heads
-- depend on place of supply. Tax is recorded on the document as charged so that a
-- later change to the factory profile or a customer's address can never restate a
-- filed return.

-- Place of supply lives on the customer.
ALTER TABLE "customer" ADD COLUMN "state_code" TEXT;
ALTER TABLE "customer" ADD COLUMN "gstin" TEXT;

ALTER TABLE "invoice" ADD COLUMN "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "cgst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "sgst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "igst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "gst_rate_pct"   DECIMAL(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "place_of_supply" TEXT;
ALTER TABLE "invoice" ADD COLUMN "supplier_state"  TEXT;

ALTER TABLE "credit_note" ADD COLUMN "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_note" ADD COLUMN "cgst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_note" ADD COLUMN "sgst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_note" ADD COLUMN "igst_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_note" ADD COLUMN "gst_rate_pct"   DECIMAL(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE "credit_note" ADD COLUMN "place_of_supply" TEXT;
ALTER TABLE "credit_note" ADD COLUMN "supplier_state"  TEXT;

-- Backfill: rows written before this migration treated "amount" as tax-inclusive.
-- Restate them as taxable value only, with zero tax and no place of supply, so they
-- are visibly un-taxed rather than silently mis-taxed. Any such row predates GST
-- registration; none carries a filed return.
UPDATE "invoice"     SET "taxable_amount" = "amount" WHERE "taxable_amount" = 0;
UPDATE "credit_note" SET "taxable_amount" = "amount" WHERE "taxable_amount" = 0;

-- Tax heads must be separable for GSTR-1. A single GST_OUTPUT ledger cannot be split
-- after the fact, so retire it in favour of one ledger per head.
UPDATE "ledger" SET "code" = 'GST_OUTPUT_IGST', "name" = 'IGST output'
 WHERE "code" = 'GST_OUTPUT';
