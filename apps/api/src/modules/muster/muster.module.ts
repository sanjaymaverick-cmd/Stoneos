import { Module } from "@nestjs/common";
import { BooksModule } from "../books/books.module";
import { MusterController } from "./muster.controller";
import { MusterService } from "./muster.service";

@Module({
  imports: [BooksModule],
  controllers: [MusterController],
  providers: [MusterService],
})
export class MusterModule {}
