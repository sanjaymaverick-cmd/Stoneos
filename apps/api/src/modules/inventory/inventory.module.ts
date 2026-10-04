import { FinishedPurchasesService } from "./finished-purchases.service";
import { Module } from "@nestjs/common";
import { BooksModule } from "../books/books.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({
  // Receiving a block posts a purchase voucher. BooksModule does not depend on
  // inventory, so this edge stays acyclic.
  imports: [BooksModule],
  controllers: [InventoryController],
  providers: [InventoryService, FinishedPurchasesService],
  exports: [InventoryService],
})
export class InventoryModule {}
