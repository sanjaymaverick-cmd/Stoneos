import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { IdempotencyInterceptor } from "./common/idempotency";
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
import { DailyReportService } from "./modules/reports/daily-report.service";
import { LotsController } from "./modules/lots/lots.controller";
import { LotsService } from "./modules/lots/lots.service";
import { SalesModule } from "./modules/sales/sales.module";
import { TallyModule } from "./modules/tally/tally.module";
import { FilesModule } from "./modules/files/files.module";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module";
import { BooksModule } from "./modules/books/books.module";
import { IntakeModule } from "./modules/books/intake.module";
import { MusterModule } from "./modules/muster/muster.module";
import { GstModule } from "./modules/gst/gst.module";

@Module({
  imports: [
    CommonModule,
    AuthModule,
    AdminModule,
    InventoryModule,
    ProductionModule,
    BooksModule,
    SalesModule,
    ExpensesModule,
    TallyModule,
    FilesModule,
    MaintenanceModule,
    IntakeModule,
    MusterModule,
    GstModule,
  ],
  controllers: [HealthController, ReportsController, LotsController],
  providers: [
    ReportsService,
    LotsService,
    DailyReportService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
