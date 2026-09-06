import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ANY_AUTHENTICATED_ROLE, CEO_ROLES } from "@stoneos/contracts";
import { ceoExceptions, factoryRecovery, recoveryRatio } from "@stoneos/domain";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

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

  @Get("ceo")
  @Roles(...CEO_ROLES)
  async ceo(@CurrentUser() user: AuthenticatedUser) {
    const factory = await this.prisma.factory.findUniqueOrThrow({ where: { id: user.factoryId } });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);

    const [
      blocksOnHand,
      slabsOnHand,
      openCutting,
      openPolishing,
      openOrders,
      maintenanceDue,
      invoicedAll,
      collectedAll,
      invoicedMtd,
      collectedMtd,
      expensesMtd,
      damagedCost,
      blocks,
    ] = await Promise.all([
      this.prisma.rawBlock.count({ where: { factoryId: user.factoryId, currentStatus: "in_stock" } }),
      this.prisma.slab.count({ where: { factoryId: user.factoryId, salesStatus: "in_stock" } }),
      this.prisma.cuttingSession.count({ where: { factoryId: user.factoryId, status: "IN_PROGRESS" } }),
      this.prisma.polishingSession.count({ where: { factoryId: user.factoryId, status: "IN_PROGRESS" } }),
      this.prisma.salesOrder.count({ where: { factoryId: user.factoryId, status: "CONFIRMED" } }),
      this.prisma.maintenanceJob.count({
        where: { factoryId: user.factoryId, completedAt: null, dueOn: { lte: soon } },
      }),
      this.prisma.invoice.aggregate({ where: { factoryId: user.factoryId }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { factoryId: user.factoryId }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({
        where: { factoryId: user.factoryId, createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { factoryId: user.factoryId, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { factoryId: user.factoryId, expenseDate: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.cuttingSession.aggregate({
        where: { factoryId: user.factoryId },
        _sum: { damagedCostAmount: true },
      }),
      this.prisma.rawBlock.findMany({
        where: { factoryId: user.factoryId },
        include: { slabs: { include: { orderLines: true } } },
      }),
    ]);

    const recoveryRows = blocks.map((block) => {
      const soldSqft = block.slabs
        .flatMap((s) => s.orderLines)
        .reduce((sum, line) => sum + Number(line.quantitySqft), 0);
      return { soldSqft, weightTons: Number(block.weightTons ?? 0) };
    });
    const recovery = factoryRecovery(recoveryRows);
    const invoiced = Number(invoicedAll._sum.amount ?? 0);
    const collected = Number(collectedAll._sum.amount ?? 0);
    const invoicedMonth = Number(invoicedMtd._sum.amount ?? 0);
    const collectedMonth = Number(collectedMtd._sum.amount ?? 0);
    const expensesMonth = Number(expensesMtd._sum.amount ?? 0);
    const outstandingAr = Math.max(0, invoiced - collected);
    const exceptions = ceoExceptions({
      operatingStatus: factory.operatingStatus,
      recoveryRatio: recovery,
      outstandingAr,
      invoicedMtd: invoicedMonth,
      collectedMtd: collectedMonth,
      expensesMtd: expensesMonth,
      maintenanceDue,
      openCutting,
      blocksOnHand,
      slabsOnHand,
    });

    return {
      factoryName: factory.name,
      operatingStatus: factory.operatingStatus,
      generatedAt: now.toISOString(),
      source: "stoneos-ledger" as const,
      briefKind: "rule-based" as const,
      blocksOnHand,
      slabsOnHand,
      openCutting,
      openPolishing,
      openOrders,
      maintenanceDue,
      invoicedTotal: invoiced,
      collectedTotal: collected,
      outstandingAr,
      invoicedMtd: invoicedMonth,
      collectedMtd: collectedMonth,
      expensesMtd: expensesMonth,
      damagedCost: Number(damagedCost._sum.damagedCostAmount ?? 0),
      recoveryRatio: recovery,
      recoveryBenchmark: 105,
      blockRecoveries: recoveryRows
        .filter((r) => r.soldSqft > 0)
        .map((r) => ({ ...r, ratio: recoveryRatio(r.soldSqft, r.weightTons) }))
        .slice(0, 12),
      exceptions,
    };
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
