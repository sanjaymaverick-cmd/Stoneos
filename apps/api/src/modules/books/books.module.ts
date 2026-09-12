import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { FilesModule } from "../files/files.module";
import { ProductionModule } from "../production/production.module";
import { SalesModule } from "../sales/sales.module";
import { BooksController } from "./books.controller";
import { BooksService } from "./books.service";
import { CopilotService } from "./copilot.service";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";
import { KhataService } from "./khata.service";

@Module({
  imports: [FilesModule],
  controllers: [BooksController],
  providers: [BooksService, KhataService, CopilotService],
  exports: [BooksService],
})
export class BooksModule {}

@Module({
  imports: [FilesModule, SalesModule, ExpensesModule, ProductionModule, BooksModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
