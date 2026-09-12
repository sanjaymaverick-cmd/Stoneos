import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  BOOKS_STATEMENT_ROLES,
  CASH_DRAWER_LOCK_ROLES,
  CEO_ROLES,
  COPILOT_PROPOSE_ROLES,
  HISTORICAL_IMPORT_ROLES,
} from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { BooksService } from "./books.service";
import { CopilotService } from "./copilot.service";
import { KhataService } from "./khata.service";
import { parseFactoryDate } from "./money";

@ApiTags("books")
@ApiBearerAuth()
@Controller("books")
export class BooksController {
  constructor(
    @Inject(BooksService) private books: BooksService,
    @Inject(KhataService) private khata: KhataService,
    @Inject(CopilotService) private copilot: CopilotService,
  ) {}

  @Get("parties")
  @Roles(...BOOKS_STATEMENT_ROLES)
  parties(@CurrentUser() user: AuthenticatedUser) {
    return this.books.parties(user.factoryId);
  }

  @Get("parties/:id")
  @Roles(...BOOKS_STATEMENT_ROLES)
  party(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.books.partyStatement(user.factoryId, id);
  }

  @Get("trial-balance")
  @Roles(...CEO_ROLES)
  trial(@CurrentUser() user: AuthenticatedUser) {
    return this.books.trialBalance(user.factoryId);
  }

  @Get("outstanding")
  @Roles(...BOOKS_STATEMENT_ROLES)
  outstanding(@CurrentUser() user: AuthenticatedUser) {
    return this.books.outstanding(user.factoryId);
  }

  @Get("rokad")
  @Roles(...BOOKS_STATEMENT_ROLES)
  rokad(@CurrentUser() user: AuthenticatedUser, @Query("date") date?: string) {
    return this.books.rokad(user.factoryId, date ? parseFactoryDate(date) : new Date());
  }

  @Post("rokad/lock")
  @Roles(...CASH_DRAWER_LOCK_ROLES)
  lock(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { date: string; countedClose: number },
  ) {
    return this.books.lockDrawer(user, parseFactoryDate(body.date), body.countedClose);
  }

  @Post("khata/preview")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  previewKhata(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { fileName: string; text?: string; base64?: string; contentType?: string },
  ) {
    return this.khata.preview(body);
  }

  @Post("khata/import")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  importKhata(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      fileName: string;
      text?: string;
      base64?: string;
      contentType?: string;
      confirm?: boolean;
    },
  ) {
    return this.khata.importList(user, {
      fileName: body.fileName,
      body: body.text,
      text: body.text,
      base64: body.base64,
      contentType: body.contentType,
      confirm: body.confirm,
    });
  }

  @Post("copilot/propose")
  @Roles(...COPILOT_PROPOSE_ROLES)
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { text: string; date?: string; clientOpId?: string },
  ) {
    return this.copilot.propose(user, body);
  }
}
