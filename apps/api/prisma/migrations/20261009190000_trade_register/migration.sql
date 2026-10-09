CREATE TABLE "trade_document" (
 "id" TEXT PRIMARY KEY, "factory_id" TEXT NOT NULL REFERENCES "factory"("id"),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('local_sale','raw_purchase')),
 "reference" TEXT NOT NULL, "party_name" TEXT NOT NULL, "occurred_on" DATE NOT NULL,
 "material_amount" DECIMAL(14,2) NOT NULL CHECK ("material_amount">0),
 "customer_adjustment" DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK ("customer_adjustment">=0),
 "gst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK ("gst_amount">=0),
 "invoice_taxable" DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK ("invoice_taxable">=0),
 "payload" JSONB NOT NULL, "stock_status" TEXT NOT NULL,
 "request_hash" TEXT NOT NULL, "client_op_id" TEXT NOT NULL, "created_by" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "trade_document_factory_id_client_op_id_key" ON "trade_document"("factory_id","client_op_id");
CREATE UNIQUE INDEX "trade_document_factory_id_kind_party_name_reference_key" ON "trade_document"("factory_id","kind","party_name","reference");
CREATE INDEX "trade_document_factory_id_occurred_on_idx" ON "trade_document"("factory_id","occurred_on");
CREATE TABLE "trade_settlement" (
 "id" TEXT PRIMARY KEY, "document_id" TEXT NOT NULL REFERENCES "trade_document"("id"),
 "amount" DECIMAL(14,2) NOT NULL CHECK ("amount">0), "occurred_on" DATE NOT NULL,
 "payload" JSONB NOT NULL, "client_op_id" TEXT NOT NULL
);
CREATE UNIQUE INDEX "trade_settlement_document_id_client_op_id_key" ON "trade_settlement"("document_id","client_op_id");
ALTER TABLE "raw_block" ADD COLUMN "trade_reference" TEXT;
