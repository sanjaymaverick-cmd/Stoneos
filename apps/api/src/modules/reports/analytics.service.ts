import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import { parseOperationalDate } from "@stoneos/domain";
import { factoryToday } from "../books/money";
import type { AuthenticatedUser } from "../../common/current-user";
import {
  ageingBucket,
  allocationShares,
  baselineForecast,
  between,
  day,
  daysBetween,
  equipmentMetrics,
  invoiceBalance,
  minor,
  num,
  rupees,
} from "./analytics-math";

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}
  async snapshot(factoryId: string, fromIn?: string, toIn?: string) {
    const today = factoryToday();
    const to = toIn || today;
    const from = fromIn || to.slice(0, 7) + "-01";
    try {
      parseOperationalDate(from);
      parseOperationalDate(to);
    } catch {
      throw new BadRequestException("Use real YYYY-MM-DD dates");
    }
    if (from > to || to > today)
      throw new BadRequestException(
        "Choose a past or current period with start before end",
      );
    const periodDays = daysBetween(from, to) + 1;
    const priorTo = day(new Date(Date.parse(from) - 86400000));
    const priorFrom = day(new Date(Date.parse(from) - periodDays * 86400000));
    const data = await this.prisma.$transaction(
      async (tx) => {
        const [
          orders,
          blocks,
          expenses,
          invoices,
          runtime,
          machines,
          maintenance,
          settings,
          finished,
          polishing,
        ] = await Promise.all([
          tx.salesOrder.findMany({
            where: { factoryId },
            include: {
              customer: true,
              lines: { include: { slab: true } },
              invoices: { include: { creditNotes: true } },
              cashSale: true,
              returns: { include: { lines: true, creditNote: true } },
            },
          }),
          tx.rawBlock.findMany({
            where: { factoryId },
            include: {
              supplier: true,
              slabs: true,
              cuttingSessions: { include: { dayLogs: true } },
              writeOffs: true,
            },
          }),
          tx.expense.findMany({
            where: { factoryId },
            include: { allocations: true },
          }),
          tx.invoice.findMany({
            where: { factoryId },
            include: { customer: true, payments: true, creditNotes: true },
          }),
          tx.machineRuntimeLog.findMany({ where: { machine: { factoryId } } }),
          tx.machine.findMany({ where: { factoryId } }),
          tx.maintenanceJob.findMany({
            where: { factoryId },
            include: { machine: true },
          }),
          tx.analyticsSettings.findUnique({
            where: { factoryId },
            select: { targets: true },
          }),
          tx.finishedPurchase.findMany({
            where: { factoryId },
            include: { slabs: true, supplier: true },
          }),
          tx.polishingSession.findMany({
            where: { factoryId },
            include: { slabs: { include: { slab: true, rawBlock: true } } },
          }),
        ]);
        return {
          orders,
          blocks,
          expenses,
          invoices,
          runtime,
          machines,
          maintenance,
          settings,
          polishing,
          finished,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
    const sources = new Map<
      string,
      { id: string; label: string; url: string }
    >();
    const addSource = (id: string, label: string, url: string) => {
      sources.set(id, { id, label, url });
      return id;
    };
    const targets = (data.settings?.targets ?? {}) as Record<string, number>;
    const balances = data.invoices
      .filter(
        (i) =>
          (i.invoiceDate ? day(i.invoiceDate) : factoryToday(i.createdAt)) <=
          to,
      )
      .map((i) => {
        const due = invoiceBalance(i, to);
        const overdue = i.dueDate
          ? Math.max(0, daysBetween(day(i.dueDate), to))
          : null;
        return {
          id: i.id,
          number: i.invoiceNumber,
          customerId: i.customerId,
          customer: i.customer.name,
          invoiceDate: i.invoiceDate
            ? day(i.invoiceDate)
            : factoryToday(i.createdAt),
          dueDate: i.dueDate ? day(i.dueDate) : null,
          promisedPaymentDate: i.promisedPaymentDate
            ? day(i.promisedPaymentDate)
            : null,
          note: i.collectionNote,
          amountDue: rupees(due),
          daysOverdue: overdue,
          bucket:
            overdue === null
              ? "Due date missing"
              : overdue === 0
                ? "Not overdue"
                : ageingBucket(overdue),
          source: addSource(
            "invoice:" + i.id,
            i.invoiceNumber,
            "/analytics#invoice-" + i.id,
          ),
        };
      })
      .filter((i) => i.amountDue > 0)
      .sort(
        (a, b) =>
          (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) ||
          b.amountDue - a.amountDue,
      );
    const collections = {
      totalDue: balances.reduce((n, i) => n + minor(i.amountDue), 0) / 100,
      overdue:
        balances
          .filter((i) => (i.daysOverdue ?? 0) > 0)
          .reduce((n, i) => n + minor(i.amountDue), 0) / 100,
      missingDueDates: balances.filter((i) => !i.dueDate).length,
      buckets: [
        "Not overdue",
        "0–30",
        "31–60",
        "61–90",
        "90+",
        "Due date missing",
      ].map((bucket) => ({
        bucket,
        amount:
          balances
            .filter((i) => i.bucket === bucket)
            .reduce((n, i) => n + minor(i.amountDue), 0) / 100,
      })),
      invoices: balances,
    };
    const orderValue = (
      o: (typeof data.orders)[number],
      start: string,
      end: string,
    ) =>
      o.invoices
        .filter((i) =>
          between(
            i.invoiceDate ? day(i.invoiceDate) : factoryToday(i.createdAt),
            start,
            end,
          ),
        )
        .reduce((n, i) => n + minor(i.taxableAmount), 0) -
      o.invoices
        .flatMap((i) => i.creditNotes)
        .filter((c) => between(factoryToday(c.createdAt), start, end))
        .reduce((n, c) => n + minor(c.taxableAmount), 0) +
      (o.cashSale && between(o.cashSale.saleDate, start, end)
        ? minor(o.cashSale.amount)
        : 0);
    const totalsFor = (start: string, end: string) => ({
      netSales:
        data.orders.reduce((n, o) => n + orderValue(o, start, end), 0) / 100,
      collections:
        (data.invoices
          .flatMap((i) => i.payments)
          .filter((p) => between(p.paidAt, start, end))
          .reduce((n, p) => n + minor(p.amount), 0) +
          data.orders
            .filter(
              (o) => o.cashSale && between(o.cashSale.saleDate, start, end),
            )
            .reduce((n, o) => n + minor(o.cashSale!.amount), 0)) /
        100,
      expenses:
        data.expenses
          .filter((e) => between(e.expenseDate, start, end))
          .reduce((n, e) => n + minor(e.taxableAmount ?? e.amount), 0) / 100,
    });
    const current = totalsFor(from, to);
    const previous = totalsFor(priorFrom, priorTo);
    const monthKeys = Array.from({ length: 12 }, (_, i) =>
      day(
        new Date(
          Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 12 + i, 1),
        ),
      ).slice(0, 7),
    );
    const saleArea = (o: (typeof data.orders)[number], asOf: string) => {
      const recognized =
        o.invoices.some(
          (i) =>
            (i.invoiceDate ? day(i.invoiceDate) : factoryToday(i.createdAt)) <=
            asOf,
        ) || !!(o.cashSale && day(o.cashSale.saleDate) <= asOf);
      return recognized
        ? o.lines.reduce(
            (n, l) =>
              n +
              (o.returns.some(
                (r) =>
                  factoryToday(r.createdAt) <= asOf &&
                  r.lines.some((x) => x.slabId === l.slabId),
              )
                ? 0
                : num(l.quantitySqft)),
            0,
          )
        : 0;
    };
    const trends = monthKeys.map((month) => {
      const end = day(
        new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
        ),
      );
      const cutoff = end < to ? end : to;
      const before = day(new Date(Date.parse(month + "-01") - 86400000));
      return {
        month,
        ...totalsFor(month + "-01", cutoff),
        soldSqft: data.orders.reduce(
          (n, o) => n + saleArea(o, cutoff) - saleArea(o, before),
          0,
        ),
      };
    });
    const revenueByBlock = new Map<string, number>();
    const soldAreaByBlock = new Map<string, number>();
    for (const o of data.orders) {
      const gross =
        o.invoices
          .filter(
            (i) =>
              (i.invoiceDate
                ? day(i.invoiceDate)
                : factoryToday(i.createdAt)) <= today,
          )
          .reduce((n, i) => n + minor(i.taxableAmount), 0) +
        (o.cashSale && day(o.cashSale.saleDate) <= today
          ? minor(o.cashSale.amount)
          : 0);
      const weights = o.lines.map((l) => num(l.quantitySqft) * num(l.rate));
      const shares = allocationShares(
        gross,
        weights.some((w) => w > 0)
          ? weights
          : o.lines.map((l) => num(l.quantitySqft)),
      );
      for (const c of o.invoices
        .flatMap((i) => i.creditNotes)
        .filter((c) => factoryToday(c.createdAt) <= today)) {
        const returned = o.returns.find((r) => r.creditNote?.id === c.id);
        const creditWeights = returned
          ? o.lines.map((l, i) =>
              returned.lines.some((x) => x.slabId === l.slabId)
                ? weights[i]!
                : 0,
            )
          : weights;
        const reductions = allocationShares(
          minor(c.taxableAmount),
          creditWeights,
        );
        for (let i = 0; i < shares.length; i++) shares[i]! -= reductions[i]!;
      }
      const recognized =
        o.invoices.some(
          (i) =>
            (i.invoiceDate ? day(i.invoiceDate) : factoryToday(i.createdAt)) <=
            today,
        ) || Boolean(o.cashSale && day(o.cashSale.saleDate) <= today);
      for (const [i, l] of o.lines.entries()) {
        const blockId = l.rawBlockId ?? l.slab?.parentBlockId;
        if (!blockId) continue;
        revenueByBlock.set(
          blockId,
          (revenueByBlock.get(blockId) ?? 0) + shares[i]!,
        );
        if (recognized) {
          const returned = o.returns.some(
            (r) =>
              factoryToday(r.createdAt) <= today &&
              r.lines.some((x) => x.slabId === l.slabId),
          );
          soldAreaByBlock.set(
            blockId,
            (soldAreaByBlock.get(blockId) ?? 0) +
              (returned ? 0 : num(l.quantitySqft)),
          );
        }
      }
    }
    const pendingOrders = data.orders
      .filter((o) => !["CANCELLED", "DRAFT"].includes(o.status))
      .map((o) => {
        const lines = o.lines
          .map((l) => ({
            blockId: l.rawBlockId ?? l.slab?.parentBlockId,
            blockSerial:
              data.blocks.find(
                (b) => b.id === (l.rawBlockId ?? l.slab?.parentBlockId),
              )?.serialNumber ??
              l.slab?.slabSerial ??
              "Unknown",
            remaining: l.slabId
              ? l.slab?.salesStatus === "dispatched" ||
                o.returns.some((r) =>
                  r.lines.some((x) => x.slabId === l.slabId),
                )
                ? 0
                : 1
              : Math.max(0, (l.slabCount ?? 0) - l.dispatchedCount),
          }))
          .filter((l) => l.remaining > 0);
        return {
          id: o.id,
          customer: o.customer.name,
          promisedDate: o.promisedDeliveryDate
            ? day(o.promisedDeliveryDate)
            : null,
          delayed:
            !!o.promisedDeliveryDate && day(o.promisedDeliveryDate) < today,
          lines,
          source: addSource(
            "order:" + o.id,
            "Order for " + o.customer.name,
            "/analytics#order-" + o.id,
          ),
        };
      })
      .filter((o) => o.lines.length);
    const blockCosts = data.blocks.map((b) => {
      const lot = b.goodSlabCount > 0;
      const available = lot
        ? Math.max(0, b.goodSlabCount - b.brokenSlabCount - b.soldSlabCount)
        : b.slabs.filter((s) => s.salesStatus === "in_stock").length;
      const held = lot
        ? pendingOrders
            .flatMap((o) => o.lines)
            .filter((l) => l.blockId === b.id)
            .reduce((n, l) => n + l.remaining, 0)
        : b.slabs.filter((s) => s.salesStatus === "reserved").length;
      const totalArea = lot
        ? b.goodSlabCount * num(b.sqftPerSlab)
        : b.slabs.reduce((n, s) => n + num(s.lengthFt) * num(s.widthFt), 0);
      const recordedCosts = data.expenses
        .filter((e) => day(e.expenseDate) <= today)
        .flatMap((e) =>
          e.allocations
            .filter((a) => a.rawBlockId === b.id)
            .map((a) => ({
              category: e.category,
              component: a.costComponent,
              amount: minor(a.allocatedAmount),
            })),
        );
      const stoneKnown = b.purchaseTaxable !== null;
      const stone = minor(b.purchaseTaxable) + minor(b.purchaseCashAmount);
      const additional = recordedCosts.reduce((n, a) => n + a.amount, 0);
      const royaltyExpected =
        b.royaltyPerTon === null
          ? null
          : minor(num(b.royaltyPerTon) * num(b.weightTons));
      const transportExpected =
        b.transportPerTon === null
          ? null
          : minor(num(b.transportPerTon) * num(b.weightTons));
      const royaltyRecorded = recordedCosts
          .filter((c) => c.component === "royalty")
          .reduce((n, c) => n + c.amount, 0),
        transportRecorded = recordedCosts
          .filter((c) => c.component === "block_transport")
          .reduce((n, c) => n + c.amount, 0);
      const pendingPerTonCost =
        Math.max(0, (royaltyExpected ?? 0) - royaltyRecorded) +
        Math.max(0, (transportExpected ?? 0) - transportRecorded);
      const totalCost = stone + additional;
      const estimatedLandedCost = totalCost + pendingPerTonCost;
      const soldArea = soldAreaByBlock.get(b.id) ?? 0;
      const destroyedArea = b.writeOffs.reduce(
        (n, w) => n + w.slabCount * num(b.sqftPerSlab),
        0,
      );
      const fraction =
        totalArea > 0 ? Math.min(1, (soldArea + destroyedArea) / totalArea) : 0;
      const recognizedCost = Math.round(totalCost * fraction);
      const revenue = revenueByBlock.get(b.id) ?? 0;
      const count = lot ? b.goodSlabCount : b.slabs.length;
      const good = lot
        ? b.goodSlabCount
        : b.cuttingSessions.reduce(
            (n, c) => n + (c.finalGoodSlabCount ?? 0),
            0,
          );
      const cutTotal = b.cuttingSessions.reduce(
        (n, c) => n + (c.totalSlabsCut ?? 0),
        0,
      );
      const cutBroken = lot
        ? b.cuttingSessions.reduce((n, c) => n + (c.damagedSlabCount ?? 0), 0)
        : Math.max(0, cutTotal - good);
      const yardBroken = b.writeOffs.reduce((n, w) => n + w.slabCount, 0);
      const stage =
        b.currentStatus === "in_stock" && count === 0
          ? "Raw"
          : (lot
                ? b.polishedSlabCount
                : b.slabs.filter((s) => s.finish).length) > 0
            ? "Finished / mixed"
            : "Work in progress";
      const age = daysBetween(
        b.purchaseDate ? day(b.purchaseDate) : factoryToday(b.createdAt),
        today,
      );
      const complete =
        stoneKnown && !!b.costsConfirmedAt && pendingPerTonCost === 0;
      return {
        id: b.id,
        serial: b.serialNumber,
        variety: b.varietyName,
        supplierId: b.supplierId,
        supplier: b.supplier?.name ?? "Not recorded",
        ageDays: age,
        ageBucket: ageingBucket(age),
        stage,
        availableSlabs: available,
        heldForDispatch: held,
        totalArea,
        soldArea,
        revenue: rupees(revenue),
        stoneCost: stoneKnown ? rupees(stone) : null,
        allocatedCosts: rupees(additional),
        costByCategory: recordedCosts.map((c) => ({
          ...c,
          amount: rupees(c.amount),
        })),
        totalRecordedCost: stoneKnown ? rupees(totalCost) : null,
        recognizedCost: stoneKnown ? rupees(recognizedCost) : null,
        remainingRecordedValue: stoneKnown
          ? rupees(totalCost - recognizedCost)
          : null,
        blockPricePerTon:
          b.blockPricePerTon === null ? null : num(b.blockPricePerTon),
        royaltyPerTon: b.royaltyPerTon === null ? null : num(b.royaltyPerTon),
        transportPerTon:
          b.transportPerTon === null ? null : num(b.transportPerTon),
        royaltyExpected:
          royaltyExpected === null ? null : rupees(royaltyExpected),
        transportExpected:
          transportExpected === null ? null : rupees(transportExpected),
        pendingPerTonCost: rupees(pendingPerTonCost),
        estimatedLandedCost: stoneKnown ? rupees(estimatedLandedCost) : null,
        estimatedMargin: stoneKnown
          ? rupees(revenue - Math.round(estimatedLandedCost * fraction))
          : null,
        finalMargin:
          complete && fraction >= 1 && available === 0 && held === 0
            ? rupees(revenue - totalCost)
            : null,
        costStatus: !stoneKnown
          ? "Purchase cost missing"
          : pendingPerTonCost > 0
            ? "Royalty / transport expenses pending"
            : !b.costsConfirmedAt
              ? "Costs not confirmed"
              : fraction < 1 || available > 0 || held > 0
                ? "Estimated — stock or dispatch remains"
                : "Final — costs confirmed",
        costsConfirmed: !!b.costsConfirmedAt,
        goodSqft: totalArea,
        productionYield:
          num(b.weightTons) > 0 && totalArea > 0
            ? totalArea / num(b.weightTons)
            : null,
        soldRecovery:
          num(b.weightTons) > 0 &&
          fraction >= 1 &&
          available === 0 &&
          held === 0
            ? soldArea / num(b.weightTons)
            : null,
        weightTons: num(b.weightTons),
        cutBroken,
        yardBroken,
        totalCut: cutTotal,
        damagedCost:
          b.cuttingSessions.reduce(
            (n, c) => n + minor(c.damagedCostAmount),
            0,
          ) /
            100 +
          b.writeOffs.reduce((n, w) => n + minor(w.costAmount), 0) / 100,
        source: addSource(
          "block:" + b.id,
          b.serialNumber,
          "/analytics#block-" + b.id,
        ),
      };
    });
    const stock = blockCosts.filter(
      (b) => b.availableSlabs + b.heldForDispatch > 0 || b.stage === "Raw",
    );
    const purchasedStock = data.finished
      .map((p) => {
        const available = p.slabs.filter((s) => s.salesStatus === "in_stock"),
          held = p.slabs.filter(
            (s) => s.salesStatus === "reserved" || s.salesStatus === "sold",
          );
        return {
          id: p.id,
          reference: p.reference,
          variety: p.varietyName,
          kind: p.kind,
          supplier: p.supplier.name,
          ageDays: daysBetween(day(p.purchaseDate), today),
          available: available.length,
          held: held.length,
          availableSqft: available.reduce(
            (n, s) => n + num(s.lengthFt) * num(s.widthFt),
            0,
          ),
          remainingValue:
            [...available, ...held].reduce(
              (n, s) => n + minor(s.purchaseCost),
              0,
            ) / 100,
          source: addSource(
            "finished:" + p.id,
            p.reference,
            "/inventory?view=finished#finished-" + p.id,
          ),
        };
      })
      .filter((p) => p.available + p.held > 0);
    const machines = data.machines.map((m) => {
      const cuts = data.blocks.flatMap((b) =>
        b.cuttingSessions
          .filter((c) => c.machineId === m.id)
          .map((c) => ({ c, b })),
      );
      const days = new Map<string, { runtime: number; down: number }>();
      for (const { c } of cuts)
        for (const log of c.dayLogs.filter((l) =>
          between(l.operationalDate, from, to),
        )) {
          const key = day(log.operationalDate);
          const old = days.get(key) ?? { runtime: 0, down: 0 };
          days.set(key, {
            runtime: old.runtime + num(log.runtimeHours),
            down: old.down + num(log.downtimeMinutes),
          });
        }
      const polish = data.polishing.filter(
        (p) => p.machineId === m.id && between(p.operationalDate, from, to),
      );
      for (const p of polish) {
        const key = day(p.operationalDate),
          old = days.get(key) ?? { runtime: 0, down: 0 };
        days.set(key, {
          runtime: old.runtime + num(p.runtimeHours),
          down: old.down + num(p.downtimeMinutes),
        });
      }
      for (const log of data.runtime.filter(
        (l) => l.machineId === m.id && between(l.operationalDate, from, to),
      ))
        days.set(day(log.operationalDate), {
          runtime: num(log.runtimeHours),
          down: log.downtimeMinutes,
        });
      const done = cuts.filter(
        ({ c }) => c.endedAt && between(factoryToday(c.endedAt), from, to),
      );
      const cutGood = done.reduce(
        (n, { c, b }) =>
          n +
          (c.finalGoodSlabCount ?? 0) *
            (b.slabs[0]
              ? num(b.slabs[0].lengthFt) * num(b.slabs[0].widthFt)
              : num(b.sqftPerSlab)),
        0,
      );
      const cutAll = done.reduce(
        (n, { c, b }) =>
          n +
          (c.totalSlabsCut ?? 0) *
            (b.slabs[0]
              ? num(b.slabs[0].lengthFt) * num(b.slabs[0].widthFt)
              : num(b.sqftPerSlab)),
        0,
      );
      const polishGood = polish
        .filter((p) => p.status === "COMPLETED")
        .reduce(
          (n, p) =>
            n +
            p.slabs.reduce(
              (s, l) =>
                s +
                (l.slab
                  ? num(l.slab.lengthFt) * num(l.slab.widthFt)
                  : num(l.slabCount) * num(l.rawBlock?.sqftPerSlab)),
              0,
            ),
          0,
        );
      const good = cutGood + polishGood;
      const all = polish.length ? 0 : cutAll;
      const runtime = [...days.values()].reduce((n, d) => n + d.runtime, 0);
      const downtime = [...days.values()].reduce((n, d) => n + d.down, 0);
      return {
        id: m.id,
        name: m.name,
        type: m.machineType,
        plannedHoursPerDay: m.plannedHoursPerDay
          ? num(m.plannedHoursPerDay)
          : null,
        idealSqftPerHour: m.idealSqftPerHour ? num(m.idealSqftPerHour) : null,
        ...equipmentMetrics(
          runtime,
          downtime,
          good,
          all,
          m.plannedHoursPerDay ? num(m.plannedHoursPerDay) : null,
          m.idealSqftPerHour ? num(m.idealSqftPerHour) : null,
          days.size,
        ),
        source: addSource(
          "machine:" + m.id,
          m.name,
          "/analytics#machine-" + m.id,
        ),
      };
    });
    const customers = [...new Set(data.orders.map((o) => o.customerId))].map(
      (id) => {
        const orders = data.orders.filter((o) => o.customerId === id);
        let cost = 0,
          known = true;
        for (const o of orders) {
          for (const l of o.lines) {
            const block = blockCosts.find(
              (b) => b.id === (l.rawBlockId ?? l.slab?.parentBlockId),
            );
            const returned = o.returns.some(
              (r) =>
                factoryToday(r.createdAt) <= today &&
                r.lines.some((x) => x.slabId === l.slabId),
            );
            const recognized =
              o.invoices.some(
                (i) =>
                  (i.invoiceDate
                    ? day(i.invoiceDate)
                    : factoryToday(i.createdAt)) <= today,
              ) || !!(o.cashSale && day(o.cashSale.saleDate) <= today);
            if (!recognized || returned) continue;
            if (
              !block ||
              block.estimatedLandedCost === null ||
              block.totalArea <= 0
            ) {
              known = false;
              continue;
            }
            cost += Math.round(
              (minor(block.estimatedLandedCost) * num(l.quantitySqft)) /
                block.totalArea,
            );
          }
        }
        const lifetimeRevenue = orders.reduce(
          (n, o) => n + orderValue(o, "1900-01-01", today),
          0,
        );
        return {
          estimatedLifetimeMargin: known
            ? rupees(lifetimeRevenue - cost)
            : null,
          marginBasis:
            "Cumulative current cost estimate allocated by sold area, excluding GST. Not period profit.",
          id,
          name: orders[0]!.customer.name,
          netSales:
            orders.reduce((n, o) => n + orderValue(o, from, to), 0) / 100,
          dues:
            balances
              .filter((i) => i.customerId === id)
              .reduce((n, i) => n + minor(i.amountDue), 0) / 100,
          overdue:
            balances
              .filter((i) => i.customerId === id && (i.daysOverdue ?? 0) > 0)
              .reduce((n, i) => n + minor(i.amountDue), 0) / 100,
          paymentCount: data.invoices
            .filter((i) => i.customerId === id)
            .flatMap((i) => i.payments)
            .filter((p) => day(p.paidAt) <= to).length,
          source: addSource(
            "customer:" + id,
            orders[0]!.customer.name,
            "/sales/reports?side=customer&partyId=" + id,
          ),
        };
      },
    );
    const suppliers = [
      ...new Set(blockCosts.map((b) => b.supplierId).filter(Boolean)),
    ].map((id) => {
      const rows = blockCosts.filter((b) => b.supplierId === id);
      const tons = rows.reduce((n, b) => n + b.weightTons, 0);
      const produced = rows.filter((b) => b.goodSqft > 0);
      const producedTons = produced.reduce((n, b) => n + b.weightTons, 0);
      const area = produced.reduce((n, b) => n + b.goodSqft, 0);
      const costs = produced.every((b) => b.totalRecordedCost !== null)
        ? produced.reduce((n, b) => n + minor(b.totalRecordedCost), 0) / 100
        : null;
      return {
        id,
        name: rows[0]!.supplier,
        blocks: rows.length,
        tons,
        productionYield: producedTons > 0 ? area / producedTons : null,
        landedCostPerSqft: area > 0 && costs !== null ? costs / area : null,
        estimatedLandedCostPerSqft:
          area > 0 && produced.every((b) => b.estimatedLandedCost !== null)
            ? produced.reduce((n, b) => n + minor(b.estimatedLandedCost), 0) /
              100 /
              area
            : null,
        damagedSlabs: rows.reduce((n, b) => n + b.cutBroken + b.yardBroken, 0),
        source: addSource(
          "supplier:" + id,
          rows[0]!.supplier,
          "/sales/reports?side=supplier&partyId=" + id,
        ),
      };
    });
    const varieties = [...new Set(blockCosts.map((b) => b.variety))].map(
      (variety) => {
        const rows = blockCosts.filter((b) => b.variety === variety);
        return {
          variety,
          blocks: rows.length,
          revenue: rows.reduce((n, b) => n + minor(b.revenue), 0) / 100,
          estimatedMargin: rows.every((b) => b.estimatedMargin !== null)
            ? rows.reduce((n, b) => n + minor(b.estimatedMargin), 0) / 100
            : null,
          unconfirmed: rows.filter((b) => !b.costsConfirmed).length,
        };
      },
    );
    const alerts: Array<{
      id: string;
      severity: "attention" | "review";
      message: string;
      source: string;
    }> = [];
    for (const i of balances.filter((i) => (i.daysOverdue ?? 0) > 30))
      alerts.push({
        id: "overdue:" + i.id,
        severity: "attention",
        message:
          i.customer + " has an invoice overdue " + i.daysOverdue + " days.",
        source: i.source,
      });
    for (const b of stock.filter((b) => b.ageDays > 90))
      alerts.push({
        id: "stock:" + b.id,
        severity: "attention",
        message: b.serial + " has stock older than 90 days.",
        source: b.source,
      });
    for (const b of blockCosts.filter(
      (b) =>
        b.productionYield !== null &&
        b.productionYield < (targets.recoveryTarget ?? 105),
    ))
      alerts.push({
        id: "yield:" + b.id,
        severity: "review",
        message:
          b.serial +
          " production yield is below the configured target; inspect dimensions and stone quality.",
        source: b.source,
      });
    for (const b of blockCosts.filter(
      (b) =>
        b.totalCut > 0 &&
        (100 * (b.cutBroken + b.yardBroken)) / b.totalCut >
          (targets.damagePctTarget ?? 5),
    ))
      alerts.push({
        id: "damage:" + b.id,
        severity: "review",
        message: b.serial + " breakage exceeds the configured percentage.",
        source: b.source,
      });
    for (const job of data.maintenance.filter(
      (j) => !j.completedAt && day(j.dueOn) < today,
    ))
      alerts.push({
        id: "maintenance:" + job.id,
        severity: "attention",
        message: job.machine.name + ": " + job.title + " is overdue.",
        source: addSource("maintenance:" + job.id, job.title, "/maintenance"),
      });
    const possibleDuplicates = new Map<string, string>();
    for (const e of data.expenses) {
      const k =
        day(e.expenseDate) +
        "|" +
        e.category +
        "|" +
        minor(e.amount) +
        "|" +
        (e.toWhom ?? "");
      if (possibleDuplicates.has(k))
        alerts.push({
          id: "duplicate:" + e.id,
          severity: "review",
          message:
            "Similar " +
            e.category +
            " expenses on " +
            day(e.expenseDate) +
            "; compare the source documents before changing anything.",
          source: addSource(
            "expense:" + e.id,
            e.category + " expense",
            "/expenses#expense-" + e.id,
          ),
        });
      else possibleDuplicates.set(k, e.id);
    }
    const firstActivity =
      [
        ...data.invoices.flatMap((i) => i.payments.map((p) => day(p.paidAt))),
        ...data.orders
          .filter((o) => o.cashSale)
          .map((o) => day(o.cashSale!.saleDate)),
      ].sort()[0] ?? null;
    const lastComplete = day(
      new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, 0)),
    ).slice(0, 7);
    const forecast = baselineForecast(trends, firstActivity, lastComplete);
    const briefing = [
      {
        text:
          "Collections " +
          current.collections.toFixed(2) +
          " versus " +
          previous.collections.toFixed(2) +
          " in the previous comparable period.",
        source: addSource(
          "collections-summary",
          "Collections in selected period",
          "/sales/reports?type=payments&from=" + from + "&to=" + to,
        ),
      },
      {
        text:
          collections.overdue.toFixed(2) +
          " overdue across " +
          balances.filter((i) => (i.daysOverdue ?? 0) > 0).length +
          " invoices; " +
          collections.missingDueDates +
          " unpaid invoices need due dates.",
        source: addSource(
          "dues-summary",
          "Invoice ageing",
          "/analytics#collections",
        ),
      },
      {
        text:
          stock.filter((b) => b.ageDays > 90).length +
          " blocks have stock older than 90 days.",
        source: addSource("stock-summary", "Stock ageing", "/analytics#stock"),
      },
    ];
    return {
      generatedAt: new Date().toISOString(),
      period: { from, to, priorFrom, priorTo },
      stockAsOf: today,
      costsAsOf: today,
      current,
      previous,
      targets,
      trends,
      collections,
      stock,
      purchasedStock,
      blockCosts,
      varieties,
      machines,
      pendingOrders,
      customers,
      suppliers,
      alerts,
      briefing,
      forecast,
      collectionPriority: balances.map((i) => ({
        ...i,
        priority:
          i.daysOverdue === null
            ? "Set due date"
            : i.promisedPaymentDate && i.promisedPaymentDate < to
              ? "Missed promise"
              : (i.daysOverdue ?? 0) > 0
                ? "Follow up"
                : "Upcoming",
      })),
      sources: [...sources.values()],
      dataQuality: {
        missingPurchaseCost: blockCosts.filter((b) => b.stoneCost === null)
          .length,
        unconfirmedCosts: blockCosts.filter((b) => !b.costsConfirmed).length,
        missingDueDates: collections.missingDueDates,
        missingDeliveryDates: pendingOrders.filter((o) => !o.promisedDate)
          .length,
        note: "Stock and block costing are current snapshots. Sales and collections use document dates. Targets are owner settings, not industry certification. Customer margin is a cumulative area-based estimate; supplier cost figures include recorded costs only.",
      },
    };
  }
  async terms(
    user: AuthenticatedUser,
    id: string,
    input: {
      dueDate?: string | null;
      promisedPaymentDate?: string | null;
      collectionNote?: string | null;
    },
  ) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!inv) throw new NotFoundException("Invoice not found");
    const parse = (v: string | null | undefined) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      try {
        return parseOperationalDate(v);
      } catch {
        throw new BadRequestException("Use real YYYY-MM-DD dates");
      }
    };
    const dueDate = parse(input.dueDate);
    if (dueDate && day(dueDate) < day(inv.invoiceDate ?? inv.createdAt))
      throw new BadRequestException("Due date must not precede the invoice");
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        dueDate,
        promisedPaymentDate: parse(input.promisedPaymentDate),
        collectionNote:
          input.collectionNote?.slice(0, 1000) ?? input.collectionNote,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "invoice.collection-terms",
      entityType: "invoice",
      entityId: id,
    });
    return updated;
  }
  async delivery(user: AuthenticatedUser, id: string, date: string | null) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!order) throw new NotFoundException("Order not found");
    let promisedDeliveryDate: Date | null = null;
    if (date) {
      try {
        promisedDeliveryDate = parseOperationalDate(date);
      } catch {
        throw new BadRequestException("Use a real delivery date");
      }
      if (day(promisedDeliveryDate) < day(order.orderDate))
        throw new BadRequestException(
          "Delivery date must not precede the order",
        );
    }
    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { promisedDeliveryDate },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "order.delivery-promise",
      entityType: "sales_order",
      entityId: id,
    });
    return updated;
  }
  async confirmCosts(user: AuthenticatedUser, id: string, confirmed: boolean) {
    const block = await this.prisma.rawBlock.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!block) throw new NotFoundException("Block not found");
    if (confirmed) {
      const allocations = await this.prisma.expenseAllocation.findMany({
        where: {
          rawBlockId: id,
          expense: {
            factoryId: user.factoryId,
            expenseDate: { lte: new Date(factoryToday()) },
          },
        },
      });
      for (const [component, rate] of [
        ["royalty", block.royaltyPerTon],
        ["block_transport", block.transportPerTon],
      ] as const) {
        const covered = allocations
          .filter((a) => a.costComponent === component)
          .reduce((n, a) => n + minor(a.allocatedAmount), 0);
        if (rate !== null && covered < minor(num(rate) * num(block.weightTons)))
          throw new BadRequestException(
            "Allocate the royalty and block transport expenses before confirming all costs",
          );
      }
    }
    if (confirmed && block.purchaseTaxable === null)
      throw new BadRequestException(
        "Record the purchase cost before confirming all costs",
      );
    const updated = await this.prisma.rawBlock.update({
      where: { id },
      data: { costsConfirmedAt: confirmed ? new Date() : null },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "block.cost-confirmation",
      entityType: "raw_block",
      entityId: id,
      payload: { confirmed },
    });
    return updated;
  }
  async rates(
    user: AuthenticatedUser,
    id: string,
    body: {
      blockPricePerTon: number | null;
      royaltyPerTon: number | null;
      transportPerTon: number | null;
    },
  ) {
    const block = await this.prisma.rawBlock.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!block) throw new NotFoundException("Block not found");
    if (!num(block.weightTons))
      throw new BadRequestException("Record tonnage before per-ton rates");
    if (
      Object.values(body).some(
        (v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1e10),
      )
    )
      throw new BadRequestException("Per-ton rates must be nonnegative");
    if (
      body.blockPricePerTon !== null &&
      block.purchaseTaxable !== null &&
      minor(body.blockPricePerTon * num(block.weightTons)) !==
        minor(block.purchaseTaxable) + minor(block.purchaseCashAmount)
    )
      throw new BadRequestException(
        "Block price × tonnage must match the recorded billed plus cash stone cost",
      );
    const updated = await this.prisma.rawBlock.update({
      where: { id },
      data: { ...body, costsConfirmedAt: null },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "block.per-ton-costs",
      entityType: "raw_block",
      entityId: id,
      payload: body,
    });
    return updated;
  }
  async standard(
    user: AuthenticatedUser,
    id: string,
    body: {
      plannedHoursPerDay: number | null;
      idealSqftPerHour: number | null;
    },
  ) {
    const machine = await this.prisma.machine.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!machine) throw new NotFoundException("Machine not found");
    if (
      body.plannedHoursPerDay !== null &&
      (!Number.isFinite(body.plannedHoursPerDay) ||
        body.plannedHoursPerDay <= 0 ||
        body.plannedHoursPerDay > 24)
    )
      throw new BadRequestException("Planned hours must be between 0 and 24");
    if (
      body.idealSqftPerHour !== null &&
      (!Number.isFinite(body.idealSqftPerHour) ||
        body.idealSqftPerHour <= 0 ||
        body.idealSqftPerHour > 1e6)
    )
      throw new BadRequestException(
        "Production standard must be a positive sqft/hour",
      );
    const updated = await this.prisma.machine.update({
      where: { id },
      data: body,
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "machine.analytics-standard",
      entityType: "machine",
      entityId: id,
      payload: body,
    });
    return updated;
  }
}
