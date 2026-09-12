import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { AuditController } from "./audit.controller";
import { FactoriesService } from "./factories.service";
import { FactoryController } from "./factory.controller";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [InventoryModule],
  controllers: [UsersController, AuditController, FactoryController],
  providers: [UsersService, FactoriesService],
  exports: [FactoriesService],
})
export class AdminModule {}
