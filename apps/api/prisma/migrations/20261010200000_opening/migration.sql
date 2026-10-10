-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('CASH', 'BANK', 'UPI');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('CUSTOMER', 'MINE', 'STAFF', 'ADVANCE');

-- CreateEnum
CREATE TYPE "OpeningHead" AS ENUM ('CAPITAL', 'CONSTRUCTION', 'GST_INPUT_CLAIMED', 'SUBSIDY_RECEIVED', 'ICICI_PRINCIPAL_REPAID', 'ICICI_INTEREST_PAID', 'CC_INTEREST_PAID', 'MARKET_INTEREST_PAID', 'WPPF_WITHDRAWN', 'PPF_WITHDRAWN', 'SOLAR_PAID');

-- CreateTable
CREATE TABLE "money_account" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_opening" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "bank_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "royalty_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transport_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_opening" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "block_number" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "tons" DECIMAL(12,3) NOT NULL,
    "rate_per_ton" DECIMAL(14,2) NOT NULL,
    "royalty_per_ton" DECIMAL(14,2) NOT NULL DEFAULT 336,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slab_opening" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "sqft" DECIMAL(14,2) NOT NULL,
    "rate_per_sqft" DECIMAL(14,2) NOT NULL,
    "job_work" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slab_opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_opening" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settled_total" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "head" "OpeningHead" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "settled_total_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_account_factory_id_idx" ON "money_account"("factory_id");

-- CreateIndex
CREATE INDEX "party_opening_factory_id_idx" ON "party_opening"("factory_id");

-- CreateIndex
CREATE INDEX "block_opening_factory_id_idx" ON "block_opening"("factory_id");

-- CreateIndex
CREATE INDEX "slab_opening_factory_id_idx" ON "slab_opening"("factory_id");

-- CreateIndex
CREATE INDEX "store_opening_factory_id_idx" ON "store_opening"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "settled_total_factory_id_head_key" ON "settled_total"("factory_id", "head");

-- AddForeignKey
ALTER TABLE "money_account" ADD CONSTRAINT "money_account_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_opening" ADD CONSTRAINT "party_opening_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_opening" ADD CONSTRAINT "block_opening_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slab_opening" ADD CONSTRAINT "slab_opening_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_opening" ADD CONSTRAINT "store_opening_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settled_total" ADD CONSTRAINT "settled_total_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
