import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { BooksModule } from "../books/books.module";
import { InterfactoryController } from "./interfactory.controller";
import { InterfactoryService } from "./interfactory.service";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";

@Module({
  imports: [BooksModule, AdminModule],
  controllers: [SalesController, InterfactoryController],
  providers: [SalesService, InterfactoryService],
  exports: [SalesService, InterfactoryService],
})
export class SalesModule {}
