-- Give an invoice a date of its own, separate from when the row was written.
--
-- Prisma's generated form for this would be a single ADD COLUMN ... NOT NULL DEFAULT
-- CURRENT_TIMESTAMP, which stamps TODAY onto every invoice already in the table --
-- silently moving historical bills into the current GST month. So it is written by
-- hand: add it nullable, backfill, then constrain.
--
-- The backfill converts to Asia/Kolkata before taking the date. created_at is a UTC
-- instant, and an invoice raised after 18:30 UTC is already the next day in India;
-- taking ::date straight off UTC would file those a day early.

ALTER TABLE "invoice" ADD COLUMN "invoice_date" DATE;

UPDATE "invoice"
   SET "invoice_date" = ("created_at" AT TIME ZONE 'Asia/Kolkata')::date
 WHERE "invoice_date" IS NULL;

ALTER TABLE "invoice" ALTER COLUMN "invoice_date" SET NOT NULL;
ALTER TABLE "invoice" ALTER COLUMN "invoice_date" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "invoice_factory_id_invoice_date_idx" ON "invoice"("factory_id", "invoice_date");
