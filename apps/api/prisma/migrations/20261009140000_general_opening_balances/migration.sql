
ALTER TABLE raw_block ADD COLUMN opening_reference TEXT;
CREATE TABLE opening_balance_batch (
 id TEXT PRIMARY KEY, factory_id TEXT NOT NULL REFERENCES factory(id), title TEXT NOT NULL,
 effective_date DATE NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED')),
 entered_by_ids JSONB NOT NULL, approved_by_id TEXT, approved_at TIMESTAMP(3), reconciled BOOLEAN NOT NULL DEFAULT false,
 client_op_id TEXT NOT NULL, request_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,client_op_id)
);
CREATE INDEX opening_balance_batch_factory_id_status_idx ON opening_balance_batch(factory_id,status);
CREATE UNIQUE INDEX opening_balance_one_approved ON opening_balance_batch(factory_id) WHERE status='APPROVED';
CREATE TABLE opening_balance_line (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES opening_balance_batch(id), ref TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('RAW_BLOCK','UNPOLISHED_LOT','FINISHED_LOT','CONSUMABLE','DEBTOR','CREDITOR','CASH','BANK')),
 payload JSONB NOT NULL, amount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
 settled_amount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0 AND settled_amount <= amount),
 entity_id TEXT, party_id TEXT REFERENCES party(id), UNIQUE(batch_id,ref)
);
CREATE TABLE opening_settlement (
 id TEXT PRIMARY KEY, factory_id TEXT NOT NULL REFERENCES factory(id), line_id TEXT NOT NULL REFERENCES opening_balance_line(id),
 amount DECIMAL(14,2) NOT NULL CHECK (amount>0), method TEXT NOT NULL, paid_at DATE NOT NULL, note TEXT, received_by TEXT, reference TEXT,
 pending_bucket TEXT CHECK (pending_bucket IN ('cash','bank')), client_op_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(factory_id,client_op_id)
);
CREATE INDEX opening_settlement_factory_id_paid_at_idx ON opening_settlement(factory_id,paid_at);
