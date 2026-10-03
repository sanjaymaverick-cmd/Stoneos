import { Body, Controller, Get, Inject, Post, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  ANY_AUTHENTICATED_ROLE,
  COMMERCIAL_READ_ROLES,
  EXECUTIVE_ROLES,
} from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";
import { DailyReportService, type GeneratedWorkbook } from "./daily-report.service";
import { PartyReportService, type PartyFilters } from "./party-report.service";
import { ReportsService } from "./reports.service";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Send a workbook as a download.
 *
 * The file name is asserted rather than assumed safe. It is built from a parsed
 * date, so it should always pass — but a quote or newline reaching a
 * Content-Disposition header is how response headers get forged, and the check
 * costs nothing.
 */
function sendWorkbook(res: Response, workbook: GeneratedWorkbook): StreamableFile {
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

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private reports: ReportsService,
    @Inject(PartyReportService) private partyReports: PartyReportService,
    @Inject(DailyReportService) private dailyReports: DailyReportService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}

  @Get("parties")
  @Roles(...COMMERCIAL_READ_ROLES)
  parties(@CurrentUser() user: AuthenticatedUser, @Query() filters: PartyFilters) {
    return this.partyReports.report(user.factoryId, filters);
  }
  @Get("parties.xlsx")
  @Roles(...COMMERCIAL_READ_ROLES)
  async partyWorkbook(@CurrentUser() user: AuthenticatedUser, @Query() filters: PartyFilters, @Res({ passthrough: true }) res: Response) {
    res.set("Cache-Control", "no-store");
    return sendWorkbook(res, await this.partyReports.workbook(user.factoryId, filters));
  }

  @Get("today")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  async today(@CurrentUser() user: AuthenticatedUser) {
    const b = await this.reports.ceoBrief(user.factoryId);
    return {
      collectedMtd: b.collectedMtd,
      outstandingAr: b.outstandingAr,
      blocksOnHand: b.blocksOnHand,
      slabsOnHand: b.slabsOnHand,
      maintenanceDue: b.maintenanceDue,
      expensesMtd: b.expensesMtd,
      recoveryRatio: b.recoveryRatio,
      recoveryBenchmark: b.recoveryBenchmark,
    };
  }

  /**
   * One day on one tab — the file that goes out to the partners each evening.
   * Defaults to today on the factory clock.
   */
  @Get("daily.xlsx")
  @Roles(...COMMERCIAL_READ_ROLES)
  async dailyWorkbook(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
    @Query("date") date?: string,
  ) {
    return sendWorkbook(res, await this.dailyReports.dailyWorkbook(user.factoryId, date));
  }

  /**
   * The office copy: a summary sheet and a tab for every day of the month so far.
   * Defaults to the current month.
   */
  @Get("monthly.xlsx")
  @Roles(...COMMERCIAL_READ_ROLES)
  async monthlyWorkbook(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
    @Query("month") month?: string,
  ) {
    return sendWorkbook(res, await this.dailyReports.monthlyWorkbook(user.factoryId, month));
  }

  /** The same day's figures as JSON, so a screen can show them without a download. */
  @Get("daily")
  @Roles(...COMMERCIAL_READ_ROLES)
  daily(@CurrentUser() user: AuthenticatedUser, @Query("date") date?: string) {
    return this.dailyReports.dailyFigures(user.factoryId, date);
  }

  @Get("dashboard")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.shopDashboard(user.factoryId);
  }

  @Get("ceo")
  @Roles(...EXECUTIVE_ROLES)
  ceo(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.ceoBrief(user.factoryId);
  }

  @Post("ceo/ask")
  @Roles(...EXECUTIVE_ROLES)
  ask(@CurrentUser() user: AuthenticatedUser, @Body() body: { question?: string }) {
    return this.reports.ask(user.factoryId, body.question ?? "");
  }

  @Get("export/blocks.csv")
  @Roles(...COMMERCIAL_READ_ROLES)
  async exportBlocks(@CurrentUser() user: AuthenticatedUser) {
    const blocks = await this.prisma.rawBlock.findMany({ where: { factoryId: user.factoryId } });
    const header = "serial,variety,status,weightTons,quarry";
    const rows = blocks.map((b) =>
      [b.serialNumber, b.varietyName, b.currentStatus, b.weightTons ?? "", b.quarry ?? ""]
        .map(csvCell)
        .join(","),
    );
    return { csv: [header, ...rows].join("\n") };
  }

  @Get("export/slabs.csv")
  @Roles(...COMMERCIAL_READ_ROLES)
  async exportSlabs(@CurrentUser() user: AuthenticatedUser) {
    const slabs = await this.prisma.slab.findMany({ where: { factoryId: user.factoryId } });
    const header = "serial,variety,status,thicknessMm";
    const rows = slabs.map((s) =>
      [s.slabSerial, s.varietyName, s.salesStatus, s.thicknessMm].map(csvCell).join(","),
    );
    return { csv: [header, ...rows].join("\n") };
  }
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
