import { Inject, Injectable } from "@nestjs/common";
import {
  answerCeoQuestion,
  availableSlabs,
  calendarMonthUtcRange,
  ceoExceptions,
  ceoNarrative,
  factoryMonthStart,
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
    const [blocksOnHand, loosePieces, lotBlocks, openCutting, openOrders, maintenanceDue] =
      await Promise.all([
      this.prisma.rawBlock.count({ where: { factoryId, currentStatus: "in_stock" } }),
      // The older per-piece path still stocks identified slabs.
      this.prisma.slab.count({ where: { factoryId, salesStatus: "in_stock" } }),
      // And the lot path stocks counts against the block, creating no Slab rows at
      // all — so counting only the table above reported an empty yard for a factory
      // holding thousands of slabs. This is the first screen anyone opens.
      this.prisma.rawBlock.findMany({
        where: { factoryId },
        select: { goodSlabCount: true, brokenSlabCount: true, soldSlabCount: true },
      }),
      this.prisma.cuttingSession.count({ where: { factoryId, status: "IN_PROGRESS" } }),
      this.prisma.salesOrder.count({ where: { factoryId, status: "CONFIRMED" } }),
      this.prisma.maintenanceJob.count({
        where: { factoryId, completedAt: null, dueOn: { lte: soon } },
      }),
    ]);
    const slabsOnHand =
      loosePieces + lotBlocks.reduce((sum, lot) => sum + Math.max(0, availableSlabs(lot)), 0);
    return { blocksOnHand, slabsOnHand, openCutting, openOrders, maintenanceDue };
  }

  async ceoBrief(factoryId: string) {
    const factory = await this.prisma.factory.findUniqueOrThrow({
      where: { id: factoryId },
    });
    const now = new Date();
    // Month-to-date is a window, not "from the 1st onwards": a payment or expense
    // dated next month is not this month's. Timestamp columns use IST instants;
    // date-only columns use calendar dates, because Postgres truncates an instant
    // bound to a date and 00:00 IST is the previous day in UTC.
    const monthStart = factoryMonthStart(now);
    const thisMonth = new Date(monthStart.getTime() + 5.5 * 3600 * 1000)
      .toISOString()
      .slice(0, 7);
    const days = calendarMonthUtcRange(thisMonth);
    const instants = { gte: monthStart, lt: factoryMonthStart(days.end) };
    const dates = { gte: days.start, lt: days.end };
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);

    const [
      blocksOnHand,
      loosePieces,
      lotBlocks,
      openCutting,
      openPolishing,
      openOrders,
      maintenanceDue,
      invoicedAll,
      collectedAll,
      creditedAll,
      invoicedMtd,
      collectedMtd,
      expensesMtd,
      unbilledCashMtd,
      damagedCost,
      blocks,
    ] = await Promise.all([
      this.prisma.rawBlock.count({
        where: { factoryId, currentStatus: "in_stock" },
      }),
      // Per-piece stock and lot stock, added below. A cut creates no Slab rows, so
      // counting that table alone showed an empty yard on the owner's own screen.
      this.prisma.slab.count({ where: { factoryId, salesStatus: "in_stock" } }),
      this.prisma.rawBlock.findMany({
        where: { factoryId },
        select: { goodSlabCount: true, brokenSlabCount: true, soldSlabCount: true },
      }),
      this.prisma.cuttingSession.count({
        where: { factoryId, status: "IN_PROGRESS" },
      }),
      this.prisma.polishingSession.count({
        where: { factoryId, status: "IN_PROGRESS" },
      }),
      this.prisma.salesOrder.count({
        where: { factoryId, status: "CONFIRMED" },
      }),
      this.prisma.maintenanceJob.count({
        where: { factoryId, completedAt: null, dueOn: { lte: soon } },
      }),
      this.prisma.invoice.aggregate({
        where: { factoryId },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { factoryId },
        _sum: { amount: true },
      }),
      this.prisma.creditNote.aggregate({
        where: { factoryId },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: { factoryId, createdAt: instants },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { factoryId, paidAt: dates },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { factoryId, expenseDate: dates },
        _sum: { amount: true },
      }),
      this.prisma.cashSale.aggregate({
        where: { factoryId, saleDate: dates },
        _sum: { amount: true },
      }),
      this.prisma.cuttingSession.aggregate({
        where: { factoryId },
        _sum: { damagedCostAmount: true },
      }),
      this.prisma.rawBlock.findMany({
        where: { factoryId },
        include: {
          slabs: { include: { orderLines: { include: { salesOrder: true } }, returnLines: { include: { parent: true } } } },
        },
      }),
    ]);

    const invoices = await this.prisma.invoice.findMany({
      where: { factoryId },
      include: { payments: true, creditNotes: true },
    });
    const outstandingAr = invoices.reduce(
      (sum, invoice) =>
        sum +
        Math.max(
          0,
          Number(invoice.amount) -
            invoice.payments.reduce((n, p) => n + Number(p.amount), 0) -
            invoice.creditNotes.reduce((n, c) => n + Number(c.amount), 0),
        ),
      0,
    );
    const recoveryRows = blocks.map((block) => {
      const soldSqft = block.slabs
        .filter(s=>s.salesStatus === "dispatched")
        .flatMap(s=>s.orderLines.filter(l=>!s.returnLines.some(r=>r.parent.salesOrderId===l.salesOrderId)))
        .reduce((sum, line) => sum + Number(line.quantitySqft), 0);
      // Reserved pieces still belong to the yard. Only sold-out blocks contribute.
      const unsoldSlabCount = block.slabs.filter(
        (s) => s.salesStatus !== "dispatched",
      ).length;
      return {
        soldSqft,
        weightTons: Number(block.weightTons ?? 0),
        slabCount: block.slabs.length,
        unsoldSlabCount,
      };
    });
    const recovery = factoryRecovery(recoveryRows);
    const invoicedTotal = Number(invoicedAll._sum.amount ?? 0);
    const collectedTotal = Number(collectedAll._sum.amount ?? 0);
    const creditedTotal = Number(creditedAll._sum.amount ?? 0);
    // Loose identified slabs plus what the lots still hold.
    const slabsOnHand =
      loosePieces + lotBlocks.reduce((sum, lot) => sum + Math.max(0, availableSlabs(lot)), 0);

    const snap: CeoSnapshot = {
      factoryName: factory.name,
      operatingStatus: factory.operatingStatus,
      recoveryRatio: recovery.ratio,
      settledBlocks: recovery.settledBlocks,
      openBlocks: recovery.openBlocks,
      outstandingAr,
      invoicedMtd: Number(invoicedMtd._sum.amount ?? 0),
      collectedMtd: Number(collectedMtd._sum.amount ?? 0) + Number(unbilledCashMtd._sum.amount ?? 0),
      expensesMtd: Number(expensesMtd._sum.amount ?? 0),
      unbilledCashMtd: Number(unbilledCashMtd._sum.amount ?? 0),
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
      recoveryBasis: {
        settledBlocks: recovery.settledBlocks,
        openBlocks: recovery.openBlocks,
        soldSqft: recovery.soldSqft,
        tons: recovery.tons,
      },
      narrative: ceoNarrative(snap, exceptions),
      exceptions,
      blockRecoveries: recoveryRows
        .filter(
          (r) => r.soldSqft > 0 && r.slabCount > 0 && r.unsoldSlabCount === 0,
        )
        .map((r) => ({
          ...r,
          settled: r.unsoldSlabCount === 0,
          ratio: recoveryRatio(r.soldSqft, r.weightTons),
        }))
        .slice(0, 12),
    };
  }

  async ask(factoryId: string, question: string) {
    const brief = await this.ceoBrief(factoryId);
    const { answer, topic } = answerCeoQuestion(question, brief);
    return { answer, topic, engine: "snapshot-copilot" as const, generatedAt: brief.generatedAt };
  }
}
