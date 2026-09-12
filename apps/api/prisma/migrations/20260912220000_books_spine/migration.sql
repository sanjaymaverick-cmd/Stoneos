-- Vedam books: CoA, parties, balanced vouchers, rokad drawer, khata import, intake drafts.

CREATE TYPE "LedgerGroup" AS ENUM ('asset', 'liability', 'income', 'expense');
CREATE TYPE "LedgerKind" AS ENUM ('cash', 'bank', 'ar', 'ap', 'sales', 'cogs', 'expense', 'opening_equity', 'gst', 'other');
CREATE TYPE "PartyKind" AS ENUM ('customer', 'supplier', 'job');
CREATE TYPE "VoucherType" AS ENUM ('opening', 'receipt', 'payment', 'contra', 'journal', 'sales', 'credit_note');
CREATE TYPE "VoucherSource" AS ENUM ('khata_opening', 'sales_invoice', 'sales_pay', 'sales_cn', 'expense_create', 'intake_confirm', 'manual');
CREATE TYPE "CashDrawerStatus" AS ENUM ('open', 'proposed', 'locked');
CREATE TYPE "IntakeKind" AS ENUM ('rokad', 'dpr');
CREATE TYPE "IntakeStatus" AS ENUM ('proposed', 'confirmed', 'rejected', 'unreadable');

CREATE TABLE "ledger" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "LedgerGroup" NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ledger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ledger_factory_id_code_key" ON "ledger"("factory_id", "code");
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "party" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "phone" TEXT,
    "kind" "PartyKind" NOT NULL DEFAULT 'customer',
    "khata_source_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "party_factory_id_name_key_key" ON "party"("factory_id", "name_key");
CREATE INDEX "party_factory_id_kind_idx" ON "party"("factory_id", "kind");
ALTER TABLE "party" ADD CONSTRAINT "party_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "voucher" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "operational_date" DATE NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "source" "VoucherSource" NOT NULL,
    "source_id" TEXT,
    "party_id" TEXT,
    "invoice_id" TEXT,
    "file_id" TEXT,
    "memo" TEXT,
    "created_by" TEXT NOT NULL,
    "reversed_voucher_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voucher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "voucher_factory_id_client_op_id_key" ON "voucher"("factory_id", "client_op_id");
CREATE INDEX "voucher_factory_id_operational_date_idx" ON "voucher"("factory_id", "operational_date");
CREATE INDEX "voucher_factory_id_party_id_idx" ON "voucher"("factory_id", "party_id");
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "voucher_line" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "ledger_id" TEXT NOT NULL,
    "party_id" TEXT,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "voucher_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voucher_line_nonneg" CHECK ("debit" >= 0 AND "credit" >= 0),
    CONSTRAINT "voucher_line_xor" CHECK (NOT ("debit" > 0 AND "credit" > 0))
);
CREATE INDEX "voucher_line_voucher_id_idx" ON "voucher_line"("voucher_id");
CREATE INDEX "voucher_line_ledger_id_idx" ON "voucher_line"("ledger_id");
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cash_drawer_day" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "operational_date" DATE NOT NULL,
    "opening_cash" INTEGER NOT NULL DEFAULT 0,
    "counted_close" INTEGER,
    "proposed_by" TEXT,
    "confirmed_by" TEXT,
    "source_file_id" TEXT,
    "status" "CashDrawerStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_drawer_day_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cash_drawer_day_factory_id_operational_date_key" ON "cash_drawer_day"("factory_id", "operational_date");
ALTER TABLE "cash_drawer_day" ADD CONSTRAINT "cash_drawer_day_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "khata_import_batch" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_id" TEXT,
    "imported_by" TEXT NOT NULL,
    "party_count" INTEGER NOT NULL,
    "ar_minor" INTEGER NOT NULL,
    "ap_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "khata_import_batch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "khata_import_batch_factory_id_idx" ON "khata_import_batch"("factory_id");
ALTER TABLE "khata_import_batch" ADD CONSTRAINT "khata_import_batch_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "imported_khata_line" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "line_date" DATE,
    "details" TEXT NOT NULL,
    "debit_minor" INTEGER NOT NULL DEFAULT 0,
    "credit_minor" INTEGER NOT NULL DEFAULT 0,
    "balance_after" INTEGER,
    "source_file_id" TEXT,
    CONSTRAINT "imported_khata_line_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "imported_khata_line_party_id_idx" ON "imported_khata_line"("party_id");
ALTER TABLE "imported_khata_line" ADD CONSTRAINT "imported_khata_line_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "khata_import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "imported_khata_line" ADD CONSTRAINT "imported_khata_line_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "intake_draft" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "kind" "IntakeKind" NOT NULL,
    "operational_date" DATE NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'proposed',
    "client_op_id" TEXT NOT NULL,
    "source_file_id" TEXT,
    "parsed" JSONB NOT NULL,
    "mismatch" JSONB,
    "proposed_by" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_draft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "intake_draft_factory_id_client_op_id_key" ON "intake_draft"("factory_id", "client_op_id");
CREATE INDEX "intake_draft_factory_id_operational_date_idx" ON "intake_draft"("factory_id", "operational_date");
ALTER TABLE "intake_draft" ADD CONSTRAINT "intake_draft_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
