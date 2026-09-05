import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ANY_AUTHENTICATED_ROLE } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  @Get("dashboard")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  async dashboard(@CurrentUser() user: AuthenticatedUser) {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    const [blocks, slabs, openCutting, orders, maintenanceDue] = await Promise.all([
      this.prisma.rawBlock.count({ where: { factoryId: user.factoryId, currentStatus: "in_stock" } }),
      this.prisma.slab.count({ where: { factoryId: user.factoryId, salesStatus: "in_stock" } }),
      this.prisma.cuttingSession.count({ where: { factoryId: user.factoryId, status: "IN_PROGRESS" } }),
      this.prisma.salesOrder.count({ where: { factoryId: user.factoryId, status: "CONFIRMED" } }),
      this.prisma.maintenanceJob.count({
        where: { factoryId: user.factoryId, completedAt: null, dueOn: { lte: soon } },
      }),
    ]);
    return { blocksOnHand: blocks, slabsOnHand: slabs, openCutting, openOrders: orders, maintenanceDue };
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
