ALTER TABLE trade_document DROP CONSTRAINT trade_document_kind_check;
ALTER TABLE trade_document ADD CONSTRAINT trade_document_kind_check CHECK (kind IN ('local_sale','raw_purchase','ledger_sale'));
