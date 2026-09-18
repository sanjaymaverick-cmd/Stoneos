import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { BooksController } from "./books.controller";
import { BooksService } from "./books.service";
import { CopilotService } from "./copilot.service";
import { KhataService } from "./khata.service";

@Module({
  imports: [FilesModule],
  controllers: [BooksController],
  providers: [BooksService, KhataService, CopilotService],
  exports: [BooksService],
})
export class BooksModule {}
