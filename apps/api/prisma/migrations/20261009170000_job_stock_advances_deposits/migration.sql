ALTER TABLE opening_balance_line DROP CONSTRAINT opening_balance_line_kind_check;
ALTER TABLE opening_balance_line ADD CONSTRAINT opening_balance_line_kind_check
 CHECK (kind IN ('RAW_BLOCK','UNPOLISHED_LOT','FINISHED_LOT','CONSUMABLE','DEBTOR','CREDITOR','CASH','BANK','JOB_STOCK','ADVANCE','DEPOSIT'));
CREATE TABLE customer_owned_stock (
 id TEXT PRIMARY KEY, factory_id TEXT NOT NULL REFERENCES factory(id), line_id TEXT REFERENCES opening_balance_line(id),
 reference TEXT NOT NULL, customer_name TEXT, material TEXT NOT NULL, stage TEXT NOT NULL,
 sqft DECIMAL(12,2) NOT NULL CHECK (sqft > 0), weight_tons DECIMAL(10,3), as_of_date DATE NOT NULL, note TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(factory_id,reference)
);
CREATE INDEX customer_owned_stock_factory_id_idx ON customer_owned_stock(factory_id);
