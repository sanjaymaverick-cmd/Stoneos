import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { FilesModule } from "../files/files.module";
import { ProductionModule } from "../production/production.module";
import { SalesModule } from "../sales/sales.module";
import { BooksModule } from "./books.module";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";

@Module({
  imports: [FilesModule, SalesModule, ExpensesModule, ProductionModule, BooksModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
