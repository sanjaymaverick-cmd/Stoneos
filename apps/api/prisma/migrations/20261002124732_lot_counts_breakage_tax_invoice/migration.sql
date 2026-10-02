-- CreateEnum
CREATE TYPE "WriteOffStage" AS ENUM ('factory_transport', 'loading', 'yard', 'other');

-- AlterEnum
ALTER TYPE "VoucherSource" ADD VALUE 'stock_write_off';

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "billing_address" TEXT,
ADD COLUMN     "shipping_address" TEXT;

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "seller_gstin" TEXT,
ADD COLUMN     "seller_legal_name" TEXT,
ADD COLUMN     "ship_to_address" TEXT,
ADD COLUMN     "ship_to_gstin" TEXT,
ADD COLUMN     "ship_to_name" TEXT,
ADD COLUMN     "ship_to_state_code" TEXT;

-- AlterTable
ALTER TABLE "raw_block" ADD COLUMN     "broken_slab_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "good_slab_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purchase_cash_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sold_slab_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sqft_per_slab" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "sales_line_item" ADD COLUMN     "description" TEXT,
ADD COLUMN     "gst_rate_pct" DECIMAL(5,2),
ADD COLUMN     "hsn_code" TEXT,
ADD COLUMN     "raw_block_id" TEXT,
ADD COLUMN     "slab_count" INTEGER;

-- CreateTable
CREATE TABLE "stock_write_off" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "raw_block_id" TEXT NOT NULL,
    "slab_count" INTEGER NOT NULL,
    "stage" "WriteOffStage" NOT NULL,
    "reason" TEXT NOT NULL,
    "cost_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "occurred_on" DATE NOT NULL,
    "actor_id" TEXT NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_write_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_tax_line" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "hsn_code" TEXT NOT NULL,
    "gst_rate_pct" DECIMAL(5,2) NOT NULL,
    "taxable_amount" DECIMAL(14,2) NOT NULL,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_tax_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_write_off_factory_id_occurred_on_idx" ON "stock_write_off"("factory_id", "occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "stock_write_off_factory_id_client_op_id_key" ON "stock_write_off"("factory_id", "client_op_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tax_line_invoice_id_hsn_code_gst_rate_pct_key" ON "invoice_tax_line"("invoice_id", "hsn_code", "gst_rate_pct");

-- AddForeignKey
ALTER TABLE "stock_write_off" ADD CONSTRAINT "stock_write_off_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_off" ADD CONSTRAINT "stock_write_off_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line_item" ADD CONSTRAINT "sales_line_item_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tax_line" ADD CONSTRAINT "invoice_tax_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
