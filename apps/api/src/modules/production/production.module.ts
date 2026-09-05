import { Module } from "@nestjs/common";
import { ConsumablesController } from "./consumables.controller";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";
import { MachineRuntimeController } from "./runtime.controller";

@Module({
  controllers: [ProductionController, ConsumablesController, MachineRuntimeController],
  providers: [ProductionService],
})
export class ProductionModule {}
