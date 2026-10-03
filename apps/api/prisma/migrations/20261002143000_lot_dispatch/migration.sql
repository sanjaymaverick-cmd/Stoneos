-- DropForeignKey
ALTER TABLE "delivery_line" DROP CONSTRAINT "delivery_line_slab_id_fkey";

-- AlterTable
ALTER TABLE "delivery_line" ADD COLUMN     "raw_block_id" TEXT,
ADD COLUMN     "slab_count" INTEGER,
ALTER COLUMN "slab_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales_line_item" ADD COLUMN     "dispatched_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "delivery_line_delivery_id_raw_block_id_key" ON "delivery_line"("delivery_id", "raw_block_id");

-- AddForeignKey
ALTER TABLE "delivery_line" ADD CONSTRAINT "delivery_line_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_line" ADD CONSTRAINT "delivery_line_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

