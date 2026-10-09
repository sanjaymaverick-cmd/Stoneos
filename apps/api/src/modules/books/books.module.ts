import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { BooksController } from "./books.controller";
import { BooksService } from "./books.service";
import { CopilotService } from "./copilot.service";
import { KhataService } from "./khata.service";

import { OpeningBalancesController } from "./opening-balances.controller";
import { OpeningBalancesService } from "./opening-balances.service";

@Module({
  imports: [FilesModule],
  controllers: [BooksController, OpeningBalancesController],
  providers: [BooksService, KhataService, CopilotService, OpeningBalancesService],
  exports: [BooksService],
})
export class BooksModule {}
