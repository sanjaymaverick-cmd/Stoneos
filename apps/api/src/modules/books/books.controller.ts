import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import {
  allStatementsSheets,
  duesReportSheets,
  partyStatementSheet,
} from "@stoneos/domain";
import { buildWorkbook } from "@stoneos/xlsx";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  BOOKS_STATEMENT_ROLES,
  CASH_DRAWER_LOCK_ROLES,
  COMMERCIAL_READ_ROLES,
  COPILOT_PROPOSE_ROLES,
  HISTORICAL_IMPORT_ROLES,
} from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { BooksService } from "./books.service";
import { CopilotService } from "./copilot.service";
import { KhataService } from "./khata.service";
import { parseFactoryDate } from "./money";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A party's name reaches a filename here, so it is stripped to what is safe in one. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned || "party";
}

/**
 * The same guard the reports controller uses: a quote or newline reaching a
 * Content-Disposition header is how response headers get forged, and a party name
 * is user input.
 */
function sendWorkbook(
  res: Response,
  workbook: { fileName: string; bytes: Buffer },
): StreamableFile {
  if (!/^[A-Za-z0-9._-]+$/.test(workbook.fileName)) {
    throw new Error(`refusing to send a workbook named ${JSON.stringify(workbook.fileName)}`);
  }
  res.set({
    "Content-Type": XLSX_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${workbook.fileName}"`,
    "Content-Length": String(workbook.bytes.length),
  });
  return new StreamableFile(workbook.bytes);
}

@ApiTags("books")
@ApiBearerAuth()
@Controller("books")
export class BooksController {
  constructor(
    @Inject(BooksService) private books: BooksService,
    @Inject(KhataService) private khata: KhataService,
    @Inject(CopilotService) private copilot: CopilotService,
  ) {}

  @Get("collections-today")
  @Roles(...BOOKS_STATEMENT_ROLES)
  async collectionsToday(@CurrentUser() user: AuthenticatedUser) {
    const date = new Date(
      new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10),
    );
    const [payments, cash] = await Promise.all([
      this.books.collectedPayments(user.factoryId, date),
      this.books.collectedCash(user.factoryId, date),
    ]);
    return { collected: payments + cash };
  }

  @Get("parties")
  @Roles(...BOOKS_STATEMENT_ROLES)
  parties(@CurrentUser() user: AuthenticatedUser) {
    return this.books.parties(user.factoryId);
  }

  @Get("parties/:id")
  @Roles(...BOOKS_STATEMENT_ROLES)
  party(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.books.partyStatement(user.factoryId, id, {
      from: from ? parseFactoryDate(from) : undefined,
      to: to ? parseFactoryDate(to) : undefined,
    });
  }

  /** One party's statement as a workbook, laid out the way the khata lays it out. */
  @Get("parties/:id/statement.xlsx")
  @Roles(...BOOKS_STATEMENT_ROLES)
  async partyWorkbook(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const statement = await this.books.partyStatement(user.factoryId, id, {
      from: from ? parseFactoryDate(from) : undefined,
      to: to ? parseFactoryDate(to) : undefined,
    });
    return sendWorkbook(res, {
      fileName: `statement-${safeName(statement.party.name)}.xlsx`,
      bytes: buildWorkbook([
        partyStatementSheet({ ...statement, partyName: statement.party.name }),
      ]),
    });
  }

  /** Every party, a tab each, with a summary sheet in front. */
  @Get("statements.xlsx")
  @Roles(...BOOKS_STATEMENT_ROLES)
  async allStatementsWorkbook(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const statements = await this.books.allStatements(user.factoryId, {
      from: from ? parseFactoryDate(from) : undefined,
      to: to ? parseFactoryDate(to) : undefined,
    });
    return sendWorkbook(res, {
      fileName: "customer-statements.xlsx",
      bytes: buildWorkbook(
        allStatementsSheets(statements.map((s) => ({ ...s, partyName: s.party.name }))),
      ),
    });
  }

  /** Who owes us and who we owe, in two lists. */
  @Get("dues")
  @Roles(...BOOKS_STATEMENT_ROLES)
  dues(@CurrentUser() user: AuthenticatedUser) {
    return this.books.dues(user.factoryId);
  }

  @Get("dues.xlsx")
  @Roles(...BOOKS_STATEMENT_ROLES)
  async duesWorkbook(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.books.dues(user.factoryId);
    return sendWorkbook(res, { fileName: "dues.xlsx", bytes: buildWorkbook(duesReportSheets(report)) });
  }

  @Get("trial-balance")
  @Roles(...COMMERCIAL_READ_ROLES)
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
    @Body()
    body: {
      fileName: string;
      text?: string;
      base64?: string;
      contentType?: string;
    },
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
