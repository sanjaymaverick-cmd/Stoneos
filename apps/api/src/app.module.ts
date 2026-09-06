import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CommonModule } from "./common/common.module";
import { SessionGuard } from "./common/session.guard";
import { HealthController } from "./health.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { ProductionModule } from "./modules/production/production.module";
import { ReportsController } from "./modules/reports/reports.controller";
import { ReportsService } from "./modules/reports/reports.service";
import { SalesModule } from "./modules/sales/sales.module";
import { TallyModule } from "./modules/tally/tally.module";
import { FilesModule } from "./modules/files/files.module";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module";

@Module({
  imports: [
    CommonModule,
    AuthModule,
    AdminModule,
    InventoryModule,
    ProductionModule,
    SalesModule,
    ExpensesModule,
    TallyModule,
    FilesModule,
    MaintenanceModule,
  ],
  controllers: [HealthController, ReportsController],
  providers: [ReportsService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
