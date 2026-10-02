import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  HSN_FINISHED_SLAB,
  availableSlabs,
  checkCutCounts,
  checkSlabsAvailable,
  costPerSlab,
  goodFromCut,
  groupTaxLines,
  lotSqft,
  totalTax,
  uniformRatePct,
  type TaxGroupInput,
} from "@stoneos/domain";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { BooksService } from "../books/books.service";
import { postVoucher } from "../books/posting";
import {
  GST_DEFAULTS,
  isGstRateSlab,
  minorToRupees,
  normaliseStateCode,
  parseBusinessDate,
  rupeesToMinor,
  stateCodeFromGstin,
} from "../books/money";
import { nextDocumentNumber } from "../sales/document-number";

/** Prisma hands Decimal back; the arithmetic here wants plain numbers. */
const num = (value: { toString(): string } | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value.toString());

export interface LotLineInput {
  /** Block serial as the yard says it: "VG-001". */
  blockSerial: string;
  slabCount: number;
  /** Rate per sqft, quoted without tax. */
  rate: number;
  description?: string;
  hsnCode?: string;
  gstRatePct?: number;
}

@Injectable()
export class LotsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
    @Inject(BooksService) private books: BooksService,
  ) {}

  /**
   * What is on the yard, by lot.
   *
   * The screen the owner asked for: "VG-101 — 90 available", not a list of ninety
   * pieces. Lots with nothing left are dropped, since a sale cannot draw on them.
   */
  async availability(factoryId: string) {
    const blocks = await this.prisma.rawBlock.findMany({
      where: { factoryId },
      orderBy: { serialNumber: "asc" },
      select: {
        id: true,
        serialNumber: true,
        varietyName: true,
        goodSlabCount: true,
        brokenSlabCount: true,
        soldSlabCount: true,
        sqftPerSlab: true,
      },
    });
    const lots = blocks
      .map((block) => {
        const available = availableSlabs(block);
        return {
          blockId: block.id,
          blockSerial: block.serialNumber,
          variety: block.varietyName,
          goodSlabCount: block.goodSlabCount,
          brokenSlabCount: block.brokenSlabCount,
          soldSlabCount: block.soldSlabCount,
          availableSlabs: available,
          sqftPerSlab: num(block.sqftPerSlab),
          availableSqft: lotSqft(available, num(block.sqftPerSlab) || null),
        };
      })
      .filter((lot) => lot.availableSlabs > 0);

    return {
      lots,
      totalAvailableSlabs: lots.reduce((sum, lot) => sum + lot.availableSlabs, 0),
      totalAvailableSqft: lots.reduce((sum, lot) => sum + lot.availableSqft, 0),
    };
  }

  /**
   * Record a cut as counts: how many slabs came off the saw, and how many broke on it.
   *
   * The good ones become the lot's stock. Pieces lost on the saw are not written off
   * later — they never reached the yard, so they are simply absent from goodSlabCount
   * and carry none of the block's cost.
   */
  async recordCut(
    user: AuthenticatedUser,
    input: {
      blockSerial: string;
      totalSlabsCut: number;
      damagedAtSaw?: number;
      sqftPerSlab: number;
      clientOpId: string;
    },
  ) {
    const damagedAtSaw = input.damagedAtSaw ?? 0;
    const counts = checkCutCounts(input.totalSlabsCut, damagedAtSaw);
    if (counts) throw new BadRequestException(counts.message);
    if (!Number.isFinite(input.sqftPerSlab) || input.sqftPerSlab <= 0) {
      throw new BadRequestException(
        `Sqft per slab must be above zero, got ${input.sqftPerSlab}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const block = await this.requireBlock(tx, user.factoryId, input.blockSerial);
      // A block is sawn once. Recording a second cut would silently add to stock that
      // was already counted, which is how phantom slabs appear.
      if (block.goodSlabCount > 0) {
        throw new ConflictException(
          `${block.serialNumber} is already cut: ${block.goodSlabCount} slabs recorded`,
        );
      }
      const good = goodFromCut(input.totalSlabsCut, damagedAtSaw);
      const updated = await tx.rawBlock.update({
        where: { id: block.id },
        data: {
          goodSlabCount: good,
          sqftPerSlab: new Prisma.Decimal(input.sqftPerSlab),
          currentStatus: "cut",
          version: { increment: 1 },
        },
      });
      await this.audit.record({
        factoryId: user.factoryId,
        actorId: user.id,
        action: "lot.cut",
        entityType: "raw_block",
        entityId: block.id,
        payload: {
          blockSerial: block.serialNumber,
          totalSlabsCut: input.totalSlabsCut,
          damagedAtSaw,
          good,
          sqftPerSlab: input.sqftPerSlab,
        },
      });
      return {
        blockId: updated.id,
        blockSerial: updated.serialNumber,
        totalSlabsCut: input.totalSlabsCut,
        damagedAtSaw,
        goodSlabCount: good,
        availableSlabs: availableSlabs(updated),
        availableSqft: lotSqft(availableSlabs(updated), input.sqftPerSlab),
      };
    });
  }

  /**
   * Write broken slabs off a lot.
   *
   * Valued at what those slabs cost — both purchase legs over the good slabs — and
   * posted as an expense against stock, so the yard count and the balance sheet move
   * together. Recorded as its own row naming the person, the stage and the reason:
   * stock leaving without a sale is the shape of theft as much as of an accident, and
   * a silent decrement would hide either.
   */
  async writeOffBroken(
    user: AuthenticatedUser,
    input: {
      blockSerial: string;
      slabCount: number;
      stage: "factory_transport" | "loading" | "yard" | "other";
      reason: string;
      occurredOn?: string;
      clientOpId: string;
    },
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("A write-off needs a reason");
    const occurredOn = parseBusinessDate(input.occurredOn ?? new Date(), "occurredOn");

    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.stockWriteOff.findUnique({
        where: {
          factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId },
        },
      });
      if (replay) return this.writeOffResult(tx, replay.rawBlockId, replay);

      const block = await this.requireBlock(tx, user.factoryId, input.blockSerial);
      const issue = checkSlabsAvailable(block, input.slabCount);
      if (issue) throw new BadRequestException(issue.message);

      const perSlab = costPerSlab({
        purchaseTaxable: num(block.purchaseTaxable),
        purchaseCashAmount: num(block.purchaseCashAmount),
        goodSlabCount: block.goodSlabCount,
      });
      const costMinor = Math.round(rupeesToMinor(perSlab) * input.slabCount);

      const row = await tx.stockWriteOff.create({
        data: {
          factoryId: user.factoryId,
          rawBlockId: block.id,
          slabCount: input.slabCount,
          stage: input.stage,
          reason,
          costAmount: new Prisma.Decimal(minorToRupees(costMinor)),
          occurredOn,
          actorId: user.id,
          clientOpId: input.clientOpId,
        },
      });
      await tx.rawBlock.update({
        where: { id: block.id },
        data: { brokenSlabCount: { increment: input.slabCount }, version: { increment: 1 } },
      });

      // Zero-cost stock still moves on the yard; posting an empty voucher would not
      // balance, so the ledger entry is skipped and the write-off row stands alone.
      if (costMinor > 0) {
        await this.books.ensureFactoryChart(user.factoryId);
        await postVoucher(tx, {
          factoryId: user.factoryId,
          type: "journal",
          source: "stock_write_off",
          clientOpId: `writeoff:${row.id}`,
          createdBy: user.id,
          sourceId: row.id,
          memo: `Breakage ${block.serialNumber} x${input.slabCount}: ${reason}`,
          lines: [
            { ledgerCode: "EXP_BREAKAGE", debit: costMinor, credit: 0 },
            { ledgerCode: "STOCK", debit: 0, credit: costMinor },
          ],
        });
      }

      await this.audit.record({
        factoryId: user.factoryId,
        actorId: user.id,
        action: "lot.write_off",
        entityType: "stock_write_off",
        entityId: row.id,
        payload: {
          blockSerial: block.serialNumber,
          slabCount: input.slabCount,
          stage: input.stage,
          reason,
          costAmount: minorToRupees(costMinor),
        },
      });
      return this.writeOffResult(tx, block.id, row);
    });
  }

  private async writeOffResult(
    tx: Prisma.TransactionClient,
    blockId: string,
    row: { id: string; slabCount: number; stage: string; reason: string; costAmount: Prisma.Decimal },
  ) {
    const block = await tx.rawBlock.findUniqueOrThrow({ where: { id: blockId } });
    return {
      writeOffId: row.id,
      blockSerial: block.serialNumber,
      slabCount: row.slabCount,
      stage: row.stage,
      reason: row.reason,
      costAmount: num(row.costAmount),
      availableSlabs: availableSlabs(block),
      availableSqft: lotSqft(availableSlabs(block), num(block.sqftPerSlab) || null),
    };
  }

  /**
   * Sell slabs by lot: pick blocks and counts, as many as the order needs.
   *
   * "80 from VG-101, then 70 from VG-102" is one order with two lines, and it invoices
   * as one bill. Availability is checked and deducted inside the transaction, so two
   * clerks selling the last slabs at once cannot both succeed.
   */
  async sellLots(
    user: AuthenticatedUser,
    input: {
      customerId: string;
      orderDate?: string;
      lines: LotLineInput[];
      clientOpId: string;
    },
  ) {
    if (!input.lines?.length) throw new BadRequestException("A sale needs at least one lot line");
    const orderDate = parseBusinessDate(input.orderDate ?? new Date(), "orderDate");

    return this.prisma.$transaction(async (tx) => {
      // Idempotent at the service, not only over HTTP. A resent sale that slipped
      // through twice would deduct the stock twice, and the yard would be short
      // without anything saying why.
      const replay = await tx.syncOperation.findUnique({
        where: {
          factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId },
        },
      });
      if (replay) {
        const earlier = replay.response as { orderId?: string } | null;
        if (earlier?.orderId) return this.orderResult(tx, earlier.orderId);
      }

      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, factoryId: user.factoryId },
      });
      if (!customer) throw new NotFoundException("Customer not found");

      const order = await tx.salesOrder.create({
        data: {
          factoryId: user.factoryId,
          customerId: customer.id,
          status: "CONFIRMED",
          billingMode: "gst_invoice",
          orderDate,
        },
      });

      for (const line of input.lines) {
        const block = await this.requireBlock(tx, user.factoryId, line.blockSerial);
        const issue = checkSlabsAvailable(block, line.slabCount);
        if (issue) throw new BadRequestException(issue.message);
        if (!Number.isFinite(line.rate) || line.rate <= 0) {
          throw new BadRequestException(`Rate for ${line.blockSerial} must be above zero`);
        }
        const perSlab = num(block.sqftPerSlab);
        if (perSlab <= 0) {
          throw new BadRequestException(
            `${block.serialNumber} has no slab size recorded; record the cut first`,
          );
        }
        const rate = line.gstRatePct ?? GST_DEFAULTS.finishedSlab;
        if (!isGstRateSlab(rate)) {
          throw new BadRequestException(`${rate}% is not a statutory GST rate`);
        }

        await tx.salesLineItem.create({
          data: {
            salesOrderId: order.id,
            rawBlockId: block.id,
            slabCount: line.slabCount,
            description:
              line.description?.trim() ||
              `${block.varietyName} polished slabs (${block.serialNumber})`,
            hsnCode: (line.hsnCode ?? HSN_FINISHED_SLAB).trim(),
            gstRatePct: new Prisma.Decimal(rate),
            quantitySqft: new Prisma.Decimal(lotSqft(line.slabCount, perSlab)),
            rate: new Prisma.Decimal(line.rate),
          },
        });
        await tx.rawBlock.update({
          where: { id: block.id },
          data: { soldSlabCount: { increment: line.slabCount }, version: { increment: 1 } },
        });
      }

      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId: input.clientOpId,
          actorId: user.id,
          method: "POST",
          path: "/api/v1/lots/sell",
          requestHash: input.clientOpId,
          statusCode: 201,
          response: { orderId: order.id } as Prisma.InputJsonValue,
        },
      });
      await this.audit.record({
        factoryId: user.factoryId,
        actorId: user.id,
        action: "lot.sell",
        entityType: "sales_order",
        entityId: order.id,
        payload: {
          customer: customer.name,
          lines: input.lines.map((l) => ({ block: l.blockSerial, slabs: l.slabCount })),
        },
      });
      return this.orderResult(tx, order.id);
    });
  }

  private async orderResult(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { customer: true, lines: { include: { rawBlock: true } } },
    });
    return {
      orderId: order.id,
      customer: order.customer.name,
      status: order.status,
      lines: order.lines.map((line) => ({
        blockSerial: line.rawBlock?.serialNumber ?? null,
        slabCount: line.slabCount,
        description: line.description,
        hsnCode: line.hsnCode,
        gstRatePct: num(line.gstRatePct),
        quantitySqft: num(line.quantitySqft),
        rate: num(line.rate),
        amount: num(line.quantitySqft) * num(line.rate),
      })),
      taxableAmount: order.lines.reduce(
        (sum, line) => sum + num(line.quantitySqft) * num(line.rate),
        0,
      ),
    };
  }

  /**
   * Raise one tax invoice for the whole order.
   *
   * The full consideration is invoiced and taxed — there is no unbilled leg. Cash is
   * a way of paying this bill, recorded against it as a receipt.
   *
   * Seller and consignee are copied onto the document at issue. A bill already handed
   * to a buyer must not change later because someone edited a customer's address.
   */
  async invoiceOrder(
    user: AuthenticatedUser,
    input: {
      orderId: string;
      clientOpId: string;
      shipTo?: { name?: string; address?: string; gstin?: string; stateCode?: string };
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: {
          factoryId_idempotencyKey: {
            factoryId: user.factoryId,
            idempotencyKey: input.clientOpId,
          },
        },
      });
      if (existing) return this.invoiceResult(tx, existing.id);

      const order = await tx.salesOrder.findFirst({
        where: { id: input.orderId, factoryId: user.factoryId },
        include: { customer: true, lines: { include: { rawBlock: true } } },
      });
      if (!order) throw new NotFoundException("Order not found");
      if (await tx.invoice.findFirst({ where: { salesOrderId: order.id } })) {
        throw new BadRequestException("Order already invoiced");
      }
      if (order.lines.length === 0) throw new BadRequestException("Order has no lines");

      const profile = await tx.gstProfile.findUnique({ where: { factoryId: user.factoryId } });
      const factory = await tx.factory.findUniqueOrThrow({ where: { id: user.factoryId } });
      const supplierState = normaliseStateCode(profile?.stateCode ?? null);
      // Place of supply is where the goods go. A consignee in another state makes the
      // supply inter-state even when the buyer is billed locally.
      const shipStateCode =
        normaliseStateCode(input.shipTo?.stateCode ?? null) ??
        (input.shipTo?.gstin ? stateCodeFromGstin(input.shipTo.gstin) : null);
      const placeOfSupply =
        shipStateCode ??
        normaliseStateCode(order.customer.stateCode) ??
        (order.customer.gstin ? stateCodeFromGstin(order.customer.gstin) : null) ??
        supplierState;
      const registered = Boolean(supplierState);
      const interState = Boolean(
        registered && placeOfSupply && supplierState !== placeOfSupply,
      );

      const taxInput: TaxGroupInput[] = order.lines.map((line) => ({
        hsnCode: line.hsnCode ?? HSN_FINISHED_SLAB,
        // An unregistered factory charges nothing; guessing a rate would book a
        // liability that does not exist.
        gstRatePct: registered ? num(line.gstRatePct) || GST_DEFAULTS.finishedSlab : 0,
        taxableMinor: rupeesToMinor(num(line.quantitySqft) * num(line.rate)),
      }));
      const groups = groupTaxLines(taxInput, interState);
      const totals = totalTax(groups);

      const number = await nextDocumentNumber(tx, user.factoryId, "INVOICE", order.orderDate);
      const invoice = await tx.invoice.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          customerId: order.customer.id,
          invoiceNumber: number,
          amount: new Prisma.Decimal(minorToRupees(totals.totalMinor)),
          taxableAmount: new Prisma.Decimal(minorToRupees(totals.taxableMinor)),
          cgstAmount: new Prisma.Decimal(minorToRupees(totals.cgstMinor)),
          sgstAmount: new Prisma.Decimal(minorToRupees(totals.sgstMinor)),
          igstAmount: new Prisma.Decimal(minorToRupees(totals.igstMinor)),
          // Null on a mixed-rate bill: the per-HSN rows are then the only honest
          // statement of what was charged.
          gstRatePct: new Prisma.Decimal(uniformRatePct(groups) ?? 0),
          placeOfSupply,
          supplierState,
          shipToName: input.shipTo?.name?.trim() || order.customer.name,
          shipToAddress:
            input.shipTo?.address?.trim() ||
            order.customer.shippingAddress ||
            order.customer.billingAddress,
          shipToGstin: input.shipTo?.gstin?.trim() || order.customer.gstin,
          shipToStateCode: placeOfSupply,
          sellerLegalName: profile?.legalName ?? factory.name,
          sellerGstin: profile?.gstin ?? null,
          idempotencyKey: input.clientOpId,
          taxLines: {
            create: groups.map((group) => ({
              hsnCode: group.hsnCode,
              gstRatePct: new Prisma.Decimal(group.gstRatePct),
              taxableAmount: new Prisma.Decimal(minorToRupees(group.taxableMinor)),
              cgstAmount: new Prisma.Decimal(minorToRupees(group.cgstMinor)),
              sgstAmount: new Prisma.Decimal(minorToRupees(group.sgstMinor)),
              igstAmount: new Prisma.Decimal(minorToRupees(group.igstMinor)),
            })),
          },
        },
      });

      await this.books.ensureFactoryChart(user.factoryId);
      await this.books.postInvoice(tx, user, {
        invoiceId: invoice.id,
        customerName: order.customer.name,
        gst: {
          taxableMinor: totals.taxableMinor,
          cgstMinor: totals.cgstMinor,
          sgstMinor: totals.sgstMinor,
          igstMinor: totals.igstMinor,
          totalMinor: totals.totalMinor,
          interState,
          ratePct: uniformRatePct(groups) ?? 0,
          placeOfSupply,
          supplierState,
        },
        clientOpId: input.clientOpId,
      });

      await this.audit.record({
        factoryId: user.factoryId,
        actorId: user.id,
        action: "lot.invoice",
        entityType: "invoice",
        entityId: invoice.id,
        payload: { invoiceNumber: number, amount: minorToRupees(totals.totalMinor) },
      });
      return this.invoiceResult(tx, invoice.id);
    });
  }

  /** The bill, as it would be printed. */
  private async invoiceResult(tx: Prisma.TransactionClient, invoiceId: string) {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        customer: true,
        taxLines: true,
        salesOrder: { include: { lines: { include: { rawBlock: true } } } },
      },
    });
    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      seller: {
        legalName: invoice.sellerLegalName,
        gstin: invoice.sellerGstin,
        stateCode: invoice.supplierState,
      },
      billTo: {
        name: invoice.customer.name,
        address: invoice.customer.billingAddress,
        gstin: invoice.customer.gstin,
        stateCode: invoice.customer.stateCode,
      },
      shipTo: {
        name: invoice.shipToName,
        address: invoice.shipToAddress,
        gstin: invoice.shipToGstin,
        stateCode: invoice.shipToStateCode,
      },
      placeOfSupply: invoice.placeOfSupply,
      interState: num(invoice.igstAmount) > 0,
      items: invoice.salesOrder.lines.map((line) => ({
        blockSerial: line.rawBlock?.serialNumber ?? null,
        description: line.description,
        hsnCode: line.hsnCode,
        slabCount: line.slabCount,
        quantitySqft: num(line.quantitySqft),
        rate: num(line.rate),
        gstRatePct: num(line.gstRatePct),
        amount: num(line.quantitySqft) * num(line.rate),
      })),
      hsnSummary: invoice.taxLines.map((tl) => ({
        hsnCode: tl.hsnCode,
        gstRatePct: num(tl.gstRatePct),
        taxableAmount: num(tl.taxableAmount),
        cgstAmount: num(tl.cgstAmount),
        sgstAmount: num(tl.sgstAmount),
        igstAmount: num(tl.igstAmount),
      })),
      totals: {
        taxableAmount: num(invoice.taxableAmount),
        cgstAmount: num(invoice.cgstAmount),
        sgstAmount: num(invoice.sgstAmount),
        igstAmount: num(invoice.igstAmount),
        payable: num(invoice.amount),
      },
    };
  }

  private async requireBlock(
    tx: Prisma.TransactionClient,
    factoryId: string,
    blockSerial: string,
  ) {
    const serial = blockSerial?.trim();
    if (!serial) throw new BadRequestException("A block serial is required");
    const block = await tx.rawBlock.findFirst({ where: { factoryId, serialNumber: serial } });
    if (!block) throw new NotFoundException(`No block ${serial} in this factory`);
    return block;
  }
}
