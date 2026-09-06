import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ANY_AUTHENTICATED_ROLE, CEO_ROLES } from "@stoneos/contracts";
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

  @Get("dashboard")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.shopDashboard(user.factoryId);
  }

  @Get("ceo")
  @Roles(...CEO_ROLES)
  ceo(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.ceoBrief(user.factoryId);
  }

  @Post("ceo/ask")
  @Roles(...CEO_ROLES)
  ask(@CurrentUser() user: AuthenticatedUser, @Body() body: { question?: string }) {
    return this.reports.ask(user.factoryId, body.question ?? "");
  }

  @Get("export/blocks.csv")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  async exportBlocks(@CurrentUser() user: AuthenticatedUser) {
    const blocks = await this.prisma.rawBlock.findMany({ where: { factoryId: user.factoryId } });
    const header = "serial,variety,status,weightTons,quarry";
    const rows = blocks.map(
      (b) => `${b.serialNumber},${b.varietyName},${b.currentStatus},${b.weightTons ?? ""},${b.quarry ?? ""}`,
    );
    return { csv: [header, ...rows].join("\n") };
  }

  @Get("export/slabs.csv")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  async exportSlabs(@CurrentUser() user: AuthenticatedUser) {
    const slabs = await this.prisma.slab.findMany({ where: { factoryId: user.factoryId } });
    const header = "serial,variety,status,thicknessMm";
    const rows = slabs.map(
      (s) => `${s.slabSerial},${s.varietyName},${s.salesStatus},${s.thicknessMm}`,
    );
    return { csv: [header, ...rows].join("\n") };
  }
}
