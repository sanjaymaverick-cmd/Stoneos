-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'manager', 'admin', 'supervisor', 'operator', 'inventory', 'sales', 'accountant', 'auditor');

-- CreateEnum
CREATE TYPE "FactoryOperatingStatus" AS ENUM ('SETUP', 'OPENING_COUNT_IN_PROGRESS', 'OPENING_PENDING_APPROVAL', 'LIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "InventoryLocationType" AS ENUM ('RAW_YARD', 'B21_QUEUE', 'B21_WIP', 'UNPOLISHED_STOCK', 'LPM_QUEUE', 'LPM_WIP', 'FINISHED_STOCK', 'HOLD', 'PACKING', 'DELIVERED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('OPENING_RECEIPT', 'GOODS_RECEIPT', 'TRANSFER', 'PRODUCTION_ISSUE', 'PRODUCTION_COMPLETION', 'POLISHING_ISSUE', 'POLISHING_COMPLETION', 'SALES_RESERVATION', 'RESERVATION_RELEASE', 'PACKING', 'DELIVERY', 'RETURN', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "OpeningSnapshotStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryKind" AS ENUM ('RAW_BLOCK', 'UNPOLISHED_SLAB', 'POLISHED_SLAB');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('COMPANY_OWNED', 'CUSTOMER_OWNED', 'CONSIGNMENT');

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('CUTTING', 'POLISHING');

-- CreateEnum
CREATE TYPE "ProductionSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "LpmProcessType" AS ENUM ('GRINDING', 'RESIN', 'POLISHING');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConflictPolicy" AS ENUM ('STRICT', 'AUDITED_OVERWRITE');

-- CreateTable
CREATE TABLE "factory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "operating_status" "FactoryOperatingStatus" NOT NULL DEFAULT 'SETUP',
    "go_live_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "factory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_lock" (
    "id" TEXT NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL,
    "owner_user_id" TEXT NOT NULL,

    CONSTRAINT "bootstrap_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_location" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_type" "InventoryLocationType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_info" TEXT,
    "credit_limit" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "machine_type" "MachineType" NOT NULL,
    "blade_count" INTEGER,
    "head_count" INTEGER,
    "abrasives_per_head" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_block" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "variety_name" TEXT NOT NULL,
    "supplier_id" TEXT,
    "quarry" TEXT,
    "weight_tons" DECIMAL(10,3),
    "length_ft" DECIMAL(8,2),
    "width_ft" DECIMAL(8,2),
    "height_ft" DECIMAL(8,2),
    "volume_cft" DECIMAL(10,3),
    "quality_note" TEXT,
    "purchase_date" DATE,
    "invoiced_amount" DECIMAL(14,2),
    "actual_amount_paid" DECIMAL(14,2),
    "ownership_type" "OwnershipType" NOT NULL DEFAULT 'COMPANY_OWNED',
    "current_status" TEXT NOT NULL DEFAULT 'in_stock',
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "raw_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slab" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "parent_block_id" TEXT,
    "cutting_session_id" TEXT,
    "slab_serial" TEXT NOT NULL,
    "variety_name" TEXT NOT NULL,
    "thickness_mm" DECIMAL(5,2) NOT NULL DEFAULT 18.0,
    "length_ft" DECIMAL(6,2),
    "width_ft" DECIMAL(6,2),
    "finish" TEXT,
    "quality_note" TEXT,
    "sales_status" TEXT NOT NULL DEFAULT 'in_stock',
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movement" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "movement_type" "InventoryMovementType" NOT NULL,
    "raw_block_id" TEXT,
    "slab_id" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "actor_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_inventory_snapshot" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "status" "OpeningSnapshotStatus" NOT NULL DEFAULT 'DRAFT',
    "entered_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "opening_inventory_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_inventory_line" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "kind" "InventoryKind" NOT NULL,
    "raw_block_id" TEXT,
    "slab_id" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "opening_inventory_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_session" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "raw_block_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "status" "ProductionSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "expected_slab_count" INTEGER,
    "total_slabs_cut" INTEGER,
    "final_good_slab_count" INTEGER,
    "damaged_slab_count" INTEGER,
    "damaged_cost_amount" DECIMAL(14,2),
    "wastage_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cutting_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_day_log" (
    "id" TEXT NOT NULL,
    "cutting_session_id" TEXT NOT NULL,
    "operational_date" DATE NOT NULL,
    "runtime_hours" DECIMAL(4,2),
    "downtime_minutes" INTEGER,
    "downtime_reason" TEXT,
    "power_consumption_kwh" DECIMAL(10,2),
    "slabs_produced_count" INTEGER,
    "operator_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cutting_day_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polishing_session" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "operational_date" DATE NOT NULL,
    "process_type" "LpmProcessType" NOT NULL,
    "finish_type" TEXT,
    "runtime_hours" DECIMAL(4,2),
    "downtime_minutes" INTEGER,
    "operator_id" TEXT,
    "notes" TEXT,
    "status" "ProductionSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "polishing_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polishing_session_slab" (
    "id" TEXT NOT NULL,
    "polishing_session_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,

    CONSTRAINT "polishing_session_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_runtime_log" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "operational_date" DATE NOT NULL,
    "runtime_hours" DECIMAL(4,2) NOT NULL,
    "downtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_runtime_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_job" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumable" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "on_hand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "valid_until" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_line" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "slab_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity_sqft" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "quotation_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_line_item" (
    "id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "slab_id" TEXT,
    "quantity_sqft" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sales_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_list" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "packed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "packing_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_line" (
    "id" TEXT NOT NULL,
    "packing_list_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,

    CONSTRAINT "packing_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "dispatched_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_line" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,

    CONSTRAINT "delivery_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_at" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_line" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,

    CONSTRAINT "customer_return_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "vehicle_id" TEXT,
    "to_whom" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_allocation" (
    "id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "raw_block_id" TEXT,
    "allocated_amount" DECIMAL(14,2) NOT NULL,
    "allocation_batch_key" TEXT NOT NULL,

    CONSTRAINT "expense_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tally_import_batch" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "imported_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" JSONB NOT NULL,

    CONSTRAINT "tally_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_file" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operation" (
    "id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "conflict_policy" "ConflictPolicy" NOT NULL DEFAULT 'STRICT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_factory_id_idx" ON "app_user"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_token_hash_key" ON "auth_session"("token_hash");

-- CreateIndex
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");

-- CreateIndex
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");

-- CreateIndex
CREATE INDEX "audit_event_factory_id_created_at_idx" ON "audit_event"("factory_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_location_factory_id_code_key" ON "inventory_location"("factory_id", "code");

-- CreateIndex
CREATE INDEX "supplier_factory_id_idx" ON "supplier"("factory_id");

-- CreateIndex
CREATE INDEX "customer_factory_id_idx" ON "customer"("factory_id");

-- CreateIndex
CREATE INDEX "machine_factory_id_idx" ON "machine"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_block_factory_id_serial_number_key" ON "raw_block"("factory_id", "serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "slab_factory_id_slab_serial_key" ON "slab"("factory_id", "slab_serial");

-- CreateIndex
CREATE INDEX "inventory_movement_factory_id_created_at_idx" ON "inventory_movement"("factory_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movement_factory_id_idempotency_key_key" ON "inventory_movement"("factory_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "opening_inventory_snapshot_factory_id_status_idx" ON "opening_inventory_snapshot"("factory_id", "status");

-- CreateIndex
CREATE INDEX "cutting_session_factory_id_status_idx" ON "cutting_session"("factory_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_day_log_cutting_session_id_operational_date_key" ON "cutting_day_log"("cutting_session_id", "operational_date");

-- CreateIndex
CREATE INDEX "polishing_session_factory_id_operational_date_idx" ON "polishing_session"("factory_id", "operational_date");

-- CreateIndex
CREATE UNIQUE INDEX "polishing_session_slab_polishing_session_id_slab_id_key" ON "polishing_session_slab"("polishing_session_id", "slab_id");

-- CreateIndex
CREATE UNIQUE INDEX "machine_runtime_log_machine_id_operational_date_key" ON "machine_runtime_log"("machine_id", "operational_date");

-- CreateIndex
CREATE INDEX "maintenance_job_factory_id_due_on_idx" ON "maintenance_job"("factory_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "consumable_factory_id_name_key" ON "consumable"("factory_id", "name");

-- CreateIndex
CREATE INDEX "quotation_factory_id_idx" ON "quotation"("factory_id");

-- CreateIndex
CREATE INDEX "sales_order_factory_id_order_date_idx" ON "sales_order"("factory_id", "order_date");

-- CreateIndex
CREATE UNIQUE INDEX "packing_line_packing_list_id_slab_id_key" ON "packing_line"("packing_list_id", "slab_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_line_delivery_id_slab_id_key" ON "delivery_line"("delivery_id", "slab_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_factory_id_invoice_number_key" ON "invoice"("factory_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_factory_id_idempotency_key_key" ON "invoice"("factory_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_factory_id_idempotency_key_key" ON "payment"("factory_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "vehicle_factory_id_idx" ON "vehicle"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_factory_id_idempotency_key_key" ON "expense"("factory_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "expense_allocation_expense_id_allocation_batch_key_raw_bloc_key" ON "expense_allocation"("expense_id", "allocation_batch_key", "raw_block_id");

-- CreateIndex
CREATE INDEX "tally_import_batch_factory_id_idx" ON "tally_import_batch"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_factory_id_key_key" ON "stored_file"("factory_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_factory_id_client_op_id_key" ON "sync_operation"("factory_id", "client_op_id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_location" ADD CONSTRAINT "inventory_location_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine" ADD CONSTRAINT "machine_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_block" ADD CONSTRAINT "raw_block_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_block" ADD CONSTRAINT "raw_block_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_block" ADD CONSTRAINT "raw_block_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slab" ADD CONSTRAINT "slab_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slab" ADD CONSTRAINT "slab_parent_block_id_fkey" FOREIGN KEY ("parent_block_id") REFERENCES "raw_block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slab" ADD CONSTRAINT "slab_cutting_session_id_fkey" FOREIGN KEY ("cutting_session_id") REFERENCES "cutting_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slab" ADD CONSTRAINT "slab_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_inventory_snapshot" ADD CONSTRAINT "opening_inventory_snapshot_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_inventory_line" ADD CONSTRAINT "opening_inventory_line_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "opening_inventory_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_inventory_line" ADD CONSTRAINT "opening_inventory_line_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_inventory_line" ADD CONSTRAINT "opening_inventory_line_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_session" ADD CONSTRAINT "cutting_session_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_session" ADD CONSTRAINT "cutting_session_raw_block_id_fkey" FOREIGN KEY ("raw_block_id") REFERENCES "raw_block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_session" ADD CONSTRAINT "cutting_session_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_day_log" ADD CONSTRAINT "cutting_day_log_cutting_session_id_fkey" FOREIGN KEY ("cutting_session_id") REFERENCES "cutting_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polishing_session" ADD CONSTRAINT "polishing_session_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polishing_session" ADD CONSTRAINT "polishing_session_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polishing_session_slab" ADD CONSTRAINT "polishing_session_slab_polishing_session_id_fkey" FOREIGN KEY ("polishing_session_id") REFERENCES "polishing_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polishing_session_slab" ADD CONSTRAINT "polishing_session_slab_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_runtime_log" ADD CONSTRAINT "machine_runtime_log_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_job" ADD CONSTRAINT "maintenance_job_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_job" ADD CONSTRAINT "maintenance_job_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumable" ADD CONSTRAINT "consumable_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line_item" ADD CONSTRAINT "sales_line_item_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line_item" ADD CONSTRAINT "sales_line_item_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_list" ADD CONSTRAINT "packing_list_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_list" ADD CONSTRAINT "packing_list_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_line" ADD CONSTRAINT "packing_line_packing_list_id_fkey" FOREIGN KEY ("packing_list_id") REFERENCES "packing_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_line" ADD CONSTRAINT "packing_line_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_line" ADD CONSTRAINT "delivery_line_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_line" ADD CONSTRAINT "delivery_line_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return" ADD CONSTRAINT "customer_return_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_line" ADD CONSTRAINT "customer_return_line_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "customer_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_line" ADD CONSTRAINT "customer_return_line_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocation" ADD CONSTRAINT "expense_allocation_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tally_import_batch" ADD CONSTRAINT "tally_import_batch_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant RLS: ENABLE, not FORCE. The table-owning application role is
-- exempt. A non-owner role (future Copilot RO) is fully constrained.
-- Unset app.current_factory_id yields zero rows for those roles.
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'app_user','auth_session','audit_event','inventory_location','supplier','customer',
    'machine','raw_block','slab','inventory_movement','opening_inventory_snapshot',
    'cutting_session','polishing_session','quotation','sales_order','packing_list',
    'delivery','invoice','payment','expense','tally_import_batch','stored_file',
    'sync_operation','vehicle','consumable','maintenance_job'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY factory_isolation ON %I USING (factory_id = NULLIF(current_setting(''app.current_factory_id'', true), ''''))',
      tenant_table
    );
  END LOOP;
END $$;

