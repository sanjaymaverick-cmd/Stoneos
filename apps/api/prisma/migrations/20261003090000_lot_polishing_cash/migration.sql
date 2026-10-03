-- AlterEnum
ALTER TYPE "VoucherSource" ADD VALUE 'block_purchase_cash';

-- DropForeignKey
ALTER TABLE "polishing_session_slab" DROP CONSTRAINT "polishing_session_slab_slab_id_fkey";

-- AlterTable
ALTER TABLE "polishing_session_slab" ADD COLUMN     "raw_block_id" TEXT,
ADD COLUMN     "slab_count" INTEGER,
ALTER COLUMN "slab_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "raw_block" ADD COLUMN     "polished_slab_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "polishing_session_slab_polishing_session_id_raw_block_id_key" ON "polishing_session_slab"("polishing_session_id", "raw_block_id");

-- AddForeignKey
ALTER TABLE "polishing_session_slab" ADD CONSTRAINT "polishing_session_slab_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polishing_session_slab" ADD CONSTRAINT "polishing_session_slab_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

