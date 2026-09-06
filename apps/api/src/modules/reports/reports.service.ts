import { Inject, Injectable } from "@nestjs/common";
import {
  answerCeoQuestion,
  ceoExceptions,
  ceoNarrative,
  factoryRecovery,
  recoveryRatio,
  type CeoSnapshot,
} from "@stoneos/domain";
import { PrismaService } from "../../common/prisma.service";

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async shopDashboard(factoryId: string) {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    const [blocksOnHand, slabsOnHand, openCutting, openOrders, maintenanceDue] = await Promise.all([
      this.prisma.rawBlock.count({ where: { factoryId, currentStatus: "in_stock" } }),
      this.prisma.slab.count({ where: { factoryId, salesStatus: "in_stock" } }),
      this.prisma.cuttingSession.count({ where: { factoryId, status: "IN_PROGRESS" } }),
      this.prisma.salesOrder.count({ where: { factoryId, status: "CONFIRMED" } }),
      this.prisma.maintenanceJob.count({
        where: { factoryId, completedAt: null, dueOn: { lte: soon } },
      }),
    ]);
    return { blocksOnHand, slabsOnHand, openCutting, openOrders, maintenanceDue };
  }

  async ceoBrief(factoryId: string) {
    const factory = await this.prisma.factory.findUniqueOrThrow({ where: { id: factoryId } });
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
      this.prisma.rawBlock.count({ where: { factoryId, currentStatus: "in_stock" } }),
      this.prisma.slab.count({ where: { factoryId, salesStatus: "in_stock" } }),
      this.prisma.cuttingSession.count({ where: { factoryId, status: "IN_PROGRESS" } }),
      this.prisma.polishingSession.count({ where: { factoryId, status: "IN_PROGRESS" } }),
      this.prisma.salesOrder.count({ where: { factoryId, status: "CONFIRMED" } }),
      this.prisma.maintenanceJob.count({
        where: { factoryId, completedAt: null, dueOn: { lte: soon } },
      }),
      this.prisma.invoice.aggregate({ where: { factoryId }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { factoryId }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({
        where: { factoryId, createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { factoryId, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { factoryId, expenseDate: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.cuttingSession.aggregate({
        where: { factoryId },
        _sum: { damagedCostAmount: true },
      }),
      this.prisma.rawBlock.findMany({
        where: { factoryId },
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
    const invoicedTotal = Number(invoicedAll._sum.amount ?? 0);
    const collectedTotal = Number(collectedAll._sum.amount ?? 0);
    const snap: CeoSnapshot = {
      factoryName: factory.name,
      operatingStatus: factory.operatingStatus,
      recoveryRatio: recovery,
      outstandingAr: Math.max(0, invoicedTotal - collectedTotal),
      invoicedMtd: Number(invoicedMtd._sum.amount ?? 0),
      collectedMtd: Number(collectedMtd._sum.amount ?? 0),
      expensesMtd: Number(expensesMtd._sum.amount ?? 0),
      maintenanceDue,
      openCutting,
      openPolishing,
      openOrders,
      blocksOnHand,
      slabsOnHand,
      invoicedTotal,
      collectedTotal,
      damagedCost: Number(damagedCost._sum.damagedCostAmount ?? 0),
    };
    const exceptions = ceoExceptions(snap);
    return {
      ...snap,
      generatedAt: now.toISOString(),
      source: "stoneos-ledger" as const,
      briefKind: "snapshot-copilot" as const,
      recoveryBenchmark: 105,
      narrative: ceoNarrative(snap, exceptions),
      exceptions,
      blockRecoveries: recoveryRows
        .filter((r) => r.soldSqft > 0)
        .map((r) => ({ ...r, ratio: recoveryRatio(r.soldSqft, r.weightTons) }))
        .slice(0, 12),
    };
  }

  async ask(factoryId: string, question: string) {
    const brief = await this.ceoBrief(factoryId);
    const { answer, topic } = answerCeoQuestion(question, brief);
    return { answer, topic, engine: "snapshot-copilot" as const, generatedAt: brief.generatedAt };
  }
}
