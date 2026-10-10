import { Module } from "@nestjs/common";
import { OpeningController } from "./opening.controller";
import { OpeningService } from "./opening.service";

@Module({
  controllers: [OpeningController],
  providers: [OpeningService],
})
export class OpeningModule {}
