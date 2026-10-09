import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { BooksController } from "./books.controller";
import { BooksService } from "./books.service";
import { CopilotService } from "./copilot.service";
import { KhataService } from "./khata.service";

import { OpeningBalancesController } from "./opening-balances.controller";
import { OpeningBalancesService } from "./opening-balances.service";
import { TradeController } from "./trade.controller";
import { TradeService } from "./trade.service";

@Module({
  imports: [FilesModule],
  controllers: [BooksController, OpeningBalancesController, TradeController],
  providers: [BooksService, KhataService, CopilotService, OpeningBalancesService, TradeService],
  exports: [BooksService],
})
export class BooksModule {}
