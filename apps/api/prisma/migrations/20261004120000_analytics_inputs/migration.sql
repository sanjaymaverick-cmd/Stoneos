ALTER TABLE raw_block ADD COLUMN costs_confirmed_at TIMESTAMP(3);
ALTER TABLE invoice ADD COLUMN due_date DATE, ADD COLUMN promised_payment_date DATE, ADD COLUMN collection_note TEXT;
ALTER TABLE sales_order ADD COLUMN promised_delivery_date DATE;
ALTER TABLE machine ADD COLUMN planned_hours_per_day DECIMAL(4,2), ADD COLUMN ideal_sqft_per_hour DECIMAL(12,3);
CREATE TABLE consumable_movement (id TEXT PRIMARY KEY, factory_id TEXT NOT NULL REFERENCES factory(id), consumable_id TEXT NOT NULL REFERENCES consumable(id), direction TEXT NOT NULL CHECK(direction IN ('receipt','usage')), quantity DECIMAL(12,3) NOT NULL CHECK(quantity>0), reason TEXT NOT NULL, occurred_on DATE NOT NULL, actor_id TEXT NOT NULL, client_op_id TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(factory_id,client_op_id));
CREATE INDEX consumable_movement_factory_date_idx ON consumable_movement(factory_id,occurred_on);
CREATE TABLE analytics_settings (factory_id TEXT PRIMARY KEY REFERENCES factory(id), targets JSONB, openai_key_encrypted TEXT, updated_at TIMESTAMP(3) NOT NULL);
ALTER TABLE consumable_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY factory_isolation ON consumable_movement USING (factory_id = current_setting('app.current_factory_id',true)) WITH CHECK (factory_id = current_setting('app.current_factory_id',true));
CREATE POLICY factory_isolation ON analytics_settings USING (factory_id = current_setting('app.current_factory_id',true)) WITH CHECK (factory_id = current_setting('app.current_factory_id',true));

ALTER TYPE "IntakeKind" ADD VALUE 'supplier_bill';
ALTER TYPE "IntakeKind" ADD VALUE 'delivery_note';
ALTER TYPE "IntakeStatus" ADD VALUE 'reviewed';

ALTER TABLE raw_block ADD COLUMN block_price_per_ton DECIMAL(14,2), ADD COLUMN royalty_per_ton DECIMAL(14,2), ADD COLUMN transport_per_ton DECIMAL(14,2);
ALTER TABLE expense_allocation ADD COLUMN cost_component TEXT NOT NULL DEFAULT 'other' CHECK (cost_component IN ('other','royalty','block_transport'));
