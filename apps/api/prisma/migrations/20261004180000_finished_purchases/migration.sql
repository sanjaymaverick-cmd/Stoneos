-- AlterTable
ALTER TABLE "slab" ADD COLUMN     "finished_purchase_id" TEXT,
ADD COLUMN     "purchase_cost" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "finished_purchase" (
    "supplier_gstin" TEXT,
    "transport_supplier_gstin" TEXT,
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "variety_name" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "purchase_date" DATE NOT NULL,
    "goods_taxable" DECIMAL(14,2) NOT NULL,
    "gst_rate_pct" DECIMAL(5,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL,
    "sgst" DECIMAL(14,2) NOT NULL,
    "igst" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "transport_taxable" DECIMAL(14,2) NOT NULL,
    "transport_gst_rate_pct" DECIMAL(5,2) NOT NULL,
    "transport_cgst" DECIMAL(14,2) NOT NULL,
    "transport_sgst" DECIMAL(14,2) NOT NULL,
    "transport_igst" DECIMAL(14,2) NOT NULL,
    "transport_supplier_id" TEXT,
    "transport_invoice_no" TEXT,
    "transport_paid_amount" DECIMAL(14,2) NOT NULL,
    "transport_payment_method" TEXT NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_purchase_factory_id_purchase_date_idx" ON "finished_purchase"("factory_id", "purchase_date");

-- CreateIndex
CREATE UNIQUE INDEX "finished_purchase_factory_id_reference_key" ON "finished_purchase"("factory_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "finished_purchase_factory_id_client_op_id_key" ON "finished_purchase"("factory_id", "client_op_id");

-- AddForeignKey
ALTER TABLE "slab" ADD CONSTRAINT "slab_finished_purchase_id_fkey" FOREIGN KEY ("finished_purchase_id") REFERENCES "finished_purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_purchase" ADD CONSTRAINT "finished_purchase_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_purchase" ADD CONSTRAINT "finished_purchase_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_purchase" ADD CONSTRAINT "finished_purchase_transport_supplier_id_fkey" FOREIGN KEY ("transport_supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

