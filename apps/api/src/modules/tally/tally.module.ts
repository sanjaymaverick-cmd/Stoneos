import { Module } from "@nestjs/common";
import { TallyController } from "./tally.controller";
import { TallyService } from "./tally.service";

@Module({
  controllers: [TallyController],
  providers: [TallyService],
})
export class TallyModule {}
