import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  dailyReportSheets,
  formatOperationalDate,
  monthlyReportSheets,
  operationalDateFor,
  operationalDayWindow,
  operationalDaysInMonth,
  parseOperationalDate,
  type DailyReportData,
} from "@stoneos/domain";
import { buildWorkbook } from "@stoneos/xlsx";
import { PrismaService } from "../../common/prisma.service";

/** Prisma hands money and measurements back as Decimal; the report wants plain numbers. */
function num(value: { toString(): string } | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Slab area in square feet. Zero when either dimension was never recorded. */
function slabSqft(slab: { lengthFt: unknown; widthFt: unknown }): number {
  const length = num(slab.lengthFt as never);
  const width = num(slab.widthFt as never);
  return length * width;
}

export interface GeneratedWorkbook {
  fileName: string;
  bytes: Buffer;
}

@Injectable()
export class DailyReportService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /**
   * Everything that happened on one operational day.
   *
   * Date columns (`@db.Date`) are matched against the day itself. Timestamp columns
   * are matched against the 07:00-to-07:00 window, so the night shift lands on the
   * day it was worked rather than splitting at midnight.
   */
  async gather(factoryId: string, date: Date): Promise<DailyReportData> {
    const { start, end } = operationalDayWindow(date);

    const [
      factory,
      cuttingLogs,
      slabsMade,
      sessionsFinished,
      polishingSessions,
      orders,
      invoices,
      cashSales,
      collections,
      expenses,
      deliveries,
    ] = await Promise.all([
      this.prisma.factory.findUniqueOrThrow({ where: { id: factoryId }, select: { name: true } }),
      this.prisma.cuttingDayLog.findMany({
        where: { operationalDate: date, session: { factoryId } },
        include: { session: { select: { machineId: true } } },
      }),
      this.prisma.slab.findMany({
        where: { factoryId, createdAt: { gte: start, lt: end } },
        select: { lengthFt: true, widthFt: true },
      }),
      this.prisma.cuttingSession.findMany({
        where: { factoryId, status: "COMPLETED", endedAt: { gte: start, lt: end } },
        select: { damagedSlabCount: true },
      }),
      this.prisma.polishingSession.findMany({
        where: { factoryId, operationalDate: date },
        select: {
          runtimeHours: true,
          downtimeMinutes: true,
          processType: true,
          slabs: {
            select: {
              slabCount: true,
              slab: { select: { id: true, lengthFt: true, widthFt: true } },
              rawBlock: { select: { sqftPerSlab: true } },
            },
          },
        },
      }),
      this.prisma.salesOrder.findMany({
        where: { factoryId, orderDate: date, status: { not: "CANCELLED" } },
        select: { lines: { select: { quantitySqft: true, rate: true } } },
      }),
      this.prisma.invoice.findMany({
        where: { factoryId, OR: [{ invoiceDate: date }, { invoiceDate: null, createdAt: { gte: start, lt: end } }] },
        select: {
          invoiceNumber: true,
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          amount: true,
          customer: { select: { name: true } },
        },
        orderBy: { invoiceNumber: "asc" },
      }),
      this.prisma.cashSale.findMany({
        where: { factoryId, saleDate: date },
        select: { buyerName: true, amount: true },
      }),
      this.prisma.payment.findMany({
        where: { factoryId, paidAt: date },
        select: {
          amount: true,
          method: true,
          invoice: {
            select: { invoiceNumber: true, customer: { select: { name: true } } },
          },
        },
      }),
      this.prisma.expense.findMany({
        where: { factoryId, expenseDate: date },
        select: { category: true, toWhom: true, amount: true },
      }),
      this.prisma.delivery.findMany({
        where: { factoryId, dispatchedAt: { gte: start, lt: end } },
        select: {
          salesOrderId: true,
          salesOrder: { select: { customer: { select: { name: true } } } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    // Grinding, resin and polishing are separate sessions over the same slab, so a
    // slab finished today usually appears two or three times. Counting the rows
    // would report more sqft polished than the factory owns.
    const polishedSlabs = new Map(
      polishingSessions.flatMap((session) =>
        session.slabs.flatMap((s) => (s.slab ? [[s.slab.id, s.slab] as const] : [])),
      ),
    );

    // Lot lines carry a count, not identities, so they cannot be de-duplicated the
    // way pieces are: there is no way to tell whether 50 ground and 50 polished are
    // the same fifty. Only the POLISHING stage is counted — it is the one that makes
    // stock sellable, and a slab can be polished only once, so the day's POLISHING
    // lines can be summed without double counting.
    const lotLines = polishingSessions
      .filter((session) => session.processType === "POLISHING")
      .flatMap((session) => session.slabs.filter((s) => s.rawBlock && s.slabCount));
    const lotSlabsPolished = sum(lotLines.map((line) => line.slabCount ?? 0));
    const lotSqftPolished = sum(
      lotLines.map((line) => (line.slabCount ?? 0) * num(line.rawBlock?.sqftPerSlab)),
    );

    return {
      factoryName: factory.name,
      date,
      cutting: {
        machinesRunning: new Set(cuttingLogs.map((log) => log.session.machineId)).size,
        runtimeHours: sum(cuttingLogs.map((log) => num(log.runtimeHours))),
        downtimeMinutes: sum(cuttingLogs.map((log) => log.downtimeMinutes ?? 0)),
        powerKwh: sum(cuttingLogs.map((log) => num(log.powerConsumptionKwh))),
        slabsProducedPerLog: sum(cuttingLogs.map((log) => log.slabsProducedCount ?? 0)),
        slabsAddedToStock: slabsMade.length,
        sqftAddedToStock: sum(slabsMade.map(slabSqft)),
        slabsMissingDimensions: slabsMade.filter((s) => slabSqft(s) === 0).length,
        blocksCompleted: sessionsFinished.length,
        damagedSlabs: sum(sessionsFinished.map((s) => s.damagedSlabCount ?? 0)),
      },
      polishing: {
        sessions: polishingSessions.length,
        runtimeHours: sum(polishingSessions.map((s) => num(s.runtimeHours))),
        downtimeMinutes: sum(polishingSessions.map((s) => s.downtimeMinutes ?? 0)),
        slabsPolished: polishedSlabs.size + lotSlabsPolished,
        sqftPolished: sum([...polishedSlabs.values()].map(slabSqft)) + lotSqftPolished,
      },
      ordersTaken: orders.length,
      orderSqft: sum(orders.flatMap((o) => o.lines.map((l) => num(l.quantitySqft)))),
      orderValue: sum(orders.flatMap((o) => o.lines.map((l) => num(l.quantitySqft) * num(l.rate)))),
      invoices: invoices.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        customer: i.customer.name,
        taxable: num(i.taxableAmount),
        cgst: num(i.cgstAmount),
        sgst: num(i.sgstAmount),
        igst: num(i.igstAmount),
        total: num(i.amount),
      })),
      cashSales: cashSales.map((c) => ({
        buyer: c.buyerName ?? "Counter sale",
        amount: num(c.amount),
      })),
      collections: collections.map((p) => ({
        customer: p.invoice.customer.name,
        invoiceNumber: p.invoice.invoiceNumber,
        method: p.method,
        amount: num(p.amount),
      })),
      expenses: expenses.map((e) => ({
        category: e.category,
        paidTo: e.toWhom ?? "",
        amount: num(e.amount),
      })),
      dispatches: deliveries.map((d) => ({
        customer: d.salesOrder.customer.name,
        orderReference: d.salesOrderId.slice(0, 8),
        slabs: d._count.lines,
      })),
      closingStock: await this.stockAsAt(factoryId, end),
    };
  }

  /**
   * Stock as it stood at an instant, rebuilt from dated records rather than read
   * off the live status columns — otherwise every tab in a month workbook would
   * show today's position.
   */
  private async stockAsAt(factoryId: string, end: Date) {
    const [blocksReceived, blocksCut, slabsMade, slabsSent, slabsBack] = await Promise.all([
      this.prisma.rawBlock.count({
        where: {
          factoryId,
          // Older rows predate purchase_date being captured; fall back to when the
          // record was created so they are not missing from stock entirely.
          OR: [{ purchaseDate: { lt: end } }, { purchaseDate: null, createdAt: { lt: end } }],
        },
      }),
      this.prisma.cuttingSession.findMany({
        where: { factoryId, status: "COMPLETED", endedAt: { lt: end } },
        select: { rawBlockId: true },
        distinct: ["rawBlockId"],
      }),
      this.prisma.slab.count({ where: { factoryId, createdAt: { lt: end } } }),
      // Lot dispatches carry a block and a count rather than a piece, so their
      // slabId is null. Without this filter they would all collapse into one
      // "null" entry and wrongly take a slab off the per-piece stock count.
      this.prisma.deliveryLine.findMany({
        where: { delivery: { factoryId, dispatchedAt: { lt: end } }, slabId: { not: null } },
        select: { slabId: true },
        distinct: ["slabId"],
      }),
      this.prisma.customerReturnLine.findMany({
        where: { parent: { factoryId, createdAt: { lt: end } } },
        select: { slabId: true },
        distinct: ["slabId"],
      }),
    ]);

    // A returned slab is back on the yard, so it is netted out of the dispatched
    // count rather than counted as new production.
    const sentIds = new Set(slabsSent.map((line) => line.slabId));
    for (const line of slabsBack) sentIds.delete(line.slabId);

    return {
      blocksOnHand: blocksReceived - blocksCut.length,
      slabsOnHand: slabsMade - sentIds.size,
    };
  }

  /** A day's figures as data, for a screen rather than a download. */
  async dailyFigures(factoryId: string, dateInput?: string): Promise<DailyReportData> {
    return this.gather(factoryId, this.resolveDate(dateInput));
  }

  /** The partner's copy: one day, one tab. */
  async dailyWorkbook(factoryId: string, dateInput?: string): Promise<GeneratedWorkbook> {
    const date = this.resolveDate(dateInput);
    const data = await this.gather(factoryId, date);
    return {
      fileName: `daily-progress-${formatOperationalDate(date)}.xlsx`,
      bytes: buildWorkbook(dailyReportSheets(data)),
    };
  }

  /**
   * The office copy: a summary and a tab for each day of the month so far.
   *
   * Days after today are left out — the workbook grows as the month does, rather
   * than opening with thirty empty tabs on the 1st.
   */
  async monthlyWorkbook(factoryId: string, monthInput?: string): Promise<GeneratedWorkbook> {
    const month = monthInput ?? formatOperationalDate(this.today()).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException(`month must be YYYY-MM, got ${month}`);
    }
    let days: Date[];
    try {
      days = operationalDaysInMonth(month);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const today = this.today().getTime();
    const elapsed = days.filter((day) => day.getTime() <= today);

    // Gathered one day at a time on purpose. A month is a few hundred queries and
    // this runs on a two-core box that is also serving the shop floor; firing them
    // all at once would stall the people entering today's work.
    const gathered: DailyReportData[] = [];
    for (const day of elapsed) gathered.push(await this.gather(factoryId, day));

    return {
      fileName: `daily-progress-${month}.xlsx`,
      bytes: buildWorkbook(monthlyReportSheets(month, gathered)),
    };
  }

  /** Today on the factory clock, as an operational day. */
  private today(): Date {
    return operationalDateFor(new Date());
  }

  private resolveDate(input?: string): Date {
    if (!input) return this.today();
    try {
      return parseOperationalDate(input);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
