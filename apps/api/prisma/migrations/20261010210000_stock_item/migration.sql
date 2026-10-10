-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('VARIETY', 'CONSUMABLE');

-- CreateTable
CREATE TABLE "stock_item" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_item_pkey" PRIMARY KEY ("id")
);

-- Each store line is one consumable item. Variety names on slabs and blocks become variety items.
INSERT INTO "stock_item" ("id", "factory_id", "kind", "name", "name_key", "unit", "created_at")
SELECT gen_random_uuid()::text, "factory_id", 'CONSUMABLE', "name", lower("name"), "unit", "created_at"
FROM "store_opening";

INSERT INTO "stock_item" ("id", "factory_id", "kind", "name", "name_key", "unit", "created_at")
SELECT gen_random_uuid()::text, named.factory_id, 'VARIETY', named.name, lower(named.name), '', named.created_at
FROM (
    SELECT DISTINCT ON ("factory_id", lower("variety")) "factory_id", "variety" AS name, "created_at"
    FROM "slab_opening"
    ORDER BY "factory_id", lower("variety"), "created_at"
) AS named;

INSERT INTO "stock_item" ("id", "factory_id", "kind", "name", "name_key", "unit", "created_at")
SELECT gen_random_uuid()::text, named.factory_id, 'VARIETY', named.name, lower(named.name), '', named.created_at
FROM (
    SELECT DISTINCT ON ("factory_id", lower("variety")) "factory_id", "variety" AS name, "created_at"
    FROM "block_opening"
    ORDER BY "factory_id", lower("variety"), "created_at"
) AS named
WHERE NOT EXISTS (
    SELECT 1 FROM "stock_item" AS item
    WHERE item."factory_id" = named.factory_id
      AND item."kind" = 'VARIETY'
      AND item."name_key" = lower(named.name)
);

-- AlterTable
ALTER TABLE "block_opening" ADD COLUMN "item_id" TEXT;
ALTER TABLE "slab_opening" ADD COLUMN "item_id" TEXT;
ALTER TABLE "store_opening" ADD COLUMN "item_id" TEXT;

UPDATE "store_opening" AS stock
SET "item_id" = item."id"
FROM "stock_item" AS item
WHERE item."factory_id" = stock."factory_id"
  AND item."kind" = 'CONSUMABLE'
  AND item."name_key" = lower(stock."name");

UPDATE "slab_opening" AS stock
SET "item_id" = item."id"
FROM "stock_item" AS item
WHERE item."factory_id" = stock."factory_id"
  AND item."kind" = 'VARIETY'
  AND item."name_key" = lower(stock."variety");

UPDATE "block_opening" AS stock
SET "item_id" = item."id"
FROM "stock_item" AS item
WHERE item."factory_id" = stock."factory_id"
  AND item."kind" = 'VARIETY'
  AND item."name_key" = lower(stock."variety");

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "store_opening" WHERE "item_id" IS NULL)
        OR EXISTS (SELECT 1 FROM "slab_opening" WHERE "item_id" IS NULL)
        OR EXISTS (SELECT 1 FROM "block_opening" WHERE "item_id" IS NULL) THEN
        RAISE EXCEPTION 'opening stock is missing an item';
    END IF;
END $$;

ALTER TABLE "block_opening" ALTER COLUMN "item_id" SET NOT NULL;
ALTER TABLE "slab_opening" ALTER COLUMN "item_id" SET NOT NULL;
ALTER TABLE "store_opening" ALTER COLUMN "item_id" SET NOT NULL;

ALTER TABLE "block_opening" DROP COLUMN "variety";
ALTER TABLE "slab_opening" DROP COLUMN "variety";
ALTER TABLE "store_opening" DROP COLUMN "name";
ALTER TABLE "store_opening" DROP COLUMN "unit";

-- CreateIndex
CREATE INDEX "stock_item_factory_id_idx" ON "stock_item"("factory_id");
CREATE UNIQUE INDEX "stock_item_factory_id_kind_name_key_key" ON "stock_item"("factory_id", "kind", "name_key");
CREATE INDEX "block_opening_item_id_idx" ON "block_opening"("item_id");
CREATE INDEX "slab_opening_item_id_idx" ON "slab_opening"("item_id");
CREATE UNIQUE INDEX "store_opening_factory_id_item_id_key" ON "store_opening"("factory_id", "item_id");

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "block_opening" ADD CONSTRAINT "block_opening_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slab_opening" ADD CONSTRAINT "slab_opening_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_opening" ADD CONSTRAINT "store_opening_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
