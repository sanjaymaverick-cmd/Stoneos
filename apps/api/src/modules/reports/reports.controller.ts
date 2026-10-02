import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  ANY_AUTHENTICATED_ROLE,
  COMMERCIAL_READ_ROLES,
  EXECUTIVE_ROLES,
} from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private reports: ReportsService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}

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
