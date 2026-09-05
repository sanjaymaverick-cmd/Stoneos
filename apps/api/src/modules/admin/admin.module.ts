import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";
import { FactoryController } from "./factory.controller";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  controllers: [UsersController, AuditController, FactoryController],
  providers: [UsersService],
})
export class AdminModule {}
