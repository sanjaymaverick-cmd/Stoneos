import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CommonModule } from "./common/common.module";
import { SessionGuard } from "./common/session.guard";
import { HealthController } from "./health.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { SetupModule } from "./modules/setup/setup.module";
import { OpeningModule } from "./modules/opening/opening.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [CommonModule, AuthModule, SetupModule, UsersModule, OpeningModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
