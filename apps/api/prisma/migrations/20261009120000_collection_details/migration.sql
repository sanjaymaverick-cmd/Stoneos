ALTER TABLE customer ADD COLUMN pending_cash DECIMAL(14,2) NOT NULL DEFAULT 0, ADD COLUMN pending_bank DECIMAL(14,2) NOT NULL DEFAULT 0, ADD COLUMN collection_note TEXT;
ALTER TABLE customer ADD CONSTRAINT customer_pending_nonnegative CHECK (pending_cash >= 0 AND pending_bank >= 0);
ALTER TABLE payment ADD COLUMN note TEXT, ADD COLUMN received_by TEXT, ADD COLUMN reference TEXT, ADD COLUMN pending_bucket TEXT;
ALTER TABLE payment ADD CONSTRAINT payment_pending_bucket CHECK (pending_bucket IS NULL OR pending_bucket IN ('cash', 'bank'));
