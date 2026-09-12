import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { AuditController } from "./audit.controller";
import { FactoryController } from "./factory.controller";
import { FactoriesService } from "./factories.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [InventoryModule],
  controllers: [UsersController, AuditController, FactoryController],
  providers: [UsersService, FactoriesService],
  exports: [UsersService, FactoriesService],
})
export class AdminModule {}
