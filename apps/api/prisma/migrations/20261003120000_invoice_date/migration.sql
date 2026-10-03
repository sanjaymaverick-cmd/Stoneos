ALTER TABLE invoice ADD COLUMN invoice_date DATE;
-- Existing invoices retain their original IST issue date, without changing created_at.
UPDATE invoice SET invoice_date = (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date;
CREATE INDEX invoice_factory_date_idx ON invoice(factory_id, invoice_date);
ALTER TABLE raw_block ADD COLUMN purchase_payment_method TEXT;
