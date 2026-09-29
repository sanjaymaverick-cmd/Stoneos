import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { recoveryRatio } from "@stoneos/domain";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { isUniqueViolation, nextDocumentNumber } from "./document-number";
import { BooksService } from "../books/books.service";
import {
  gstOnTaxable,
  minorToRupees,
  normaliseStateCode,
  parseFactoryDateInput,
  rupeesToMinor,
  stateCodeFromGstin,
} from "../books/money";

@Injectable()
export class SalesService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
    @Inject(BooksService) private books: BooksService,
  ) {}

  customers(factoryId: string) {
    return this.prisma.customer.findMany({ where: { factoryId }, orderBy: { name: "asc" } });
  }

  async createCustomer(
    user: AuthenticatedUser,
    name: string,
    contactInfo?: string,
    gst?: { stateCode?: string | null; gstin?: string | null },
  ) {
    const gstin = gst?.gstin?.trim().toUpperCase() || null;
    // A buyer's GSTIN already states their place of supply; trust it over a typed code.
    const stateCode =
      (gstin ? stateCodeFromGstin(gstin) : null) ?? normaliseStateCode(gst?.stateCode);
    return this.prisma.customer.create({
      data: { factoryId: user.factoryId, name, contactInfo, stateCode, gstin },
    });
  }

  quotations(factoryId: string) {
    return this.prisma.quotation.findMany({
      where: { factoryId },
      include: { customer: true, lines: true },
      orderBy: { createdAt: "desc" },
    });
  }

  orders(factoryId: string) {
    return this.prisma.salesOrder.findMany({
      where: { factoryId },
      include: { customer: true, lines: true, invoices: true, deliveries: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async assertFactorySlabs(
    tx: Prisma.TransactionClient | PrismaService,
    factoryId: string,
    slabIds: Array<string | undefined>,
    orderId?: string,
  ) {
    const ids = [...new Set(slabIds.filter((id): id is string => Boolean(id)))];
    for (const slabId of ids) {
      const slab = await tx.slab.findFirst({ where: { id: slabId, factoryId } });
      if (!slab) throw new BadRequestException("Slab does not belong to this factory");
      if (orderId) {
        const onOrder = await tx.salesLineItem.findFirst({ where: { salesOrderId: orderId, slabId } });
        if (!onOrder) throw new BadRequestException("Slab is not on this order");
      }
    }
  }

  async createQuotation(
    user: AuthenticatedUser,
    input: {
      customerId: string;
      lines: Array<{ slabId?: string; description: string; quantitySqft: number; rate: number }>;
    },
  ) {
    await this.assertCustomer(user.factoryId, input.customerId);
    await this.assertFactorySlabs(this.prisma, user.factoryId, input.lines.map((l) => l.slabId));
    return this.prisma.quotation.create({
      data: {
        factoryId: user.factoryId,
        customerId: input.customerId,
        lines: { create: input.lines },
      },
      include: { lines: true },
    });
  }

  async createOrder(
    user: AuthenticatedUser,
    input: {
      customerId: string;
      orderDate: string;
      lines: Array<{ slabId?: string; quantitySqft: number; rate: number; baseVersion?: number }>;
      clientOpId: string;
      billingMode?: "gst_invoice" | "cash_unbilled";
    },
  ) {
    await this.assertCustomer(user.factoryId, input.customerId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.syncOperation.findUnique({
        where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId } },
      });
      if (existing) return existing.response;

      for (const line of input.lines) {
        if (!line.slabId) continue;
        const slab = await tx.slab.findFirst({
          where: { id: line.slabId, factoryId: user.factoryId },
          include: { location: true },
        });
        if (!slab) throw new BadRequestException("Slab does not belong to this factory");
        if (slab.salesStatus === "sold" || slab.salesStatus === "reserved" || slab.salesStatus === "dispatched") {
          throw new BadRequestException(`Slab ${slab.slabSerial} is not available`);
        }
        if (slab.location?.code === "UNPOLISHED_STOCK") {
          throw new BadRequestException(`Slab ${slab.slabSerial} has not been polished yet`);
        }
        if (line.baseVersion != null && slab.version !== line.baseVersion) {
          throw new ConflictException({
            code: "VERSION_CONFLICT",
            serverVersion: slab.version,
            server: slab,
          });
        }
        await tx.slab.update({
          where: { id: slab.id },
          data: { salesStatus: "reserved", version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "SALES_RESERVATION",
            slabId: slab.id,
            quantity: 1,
            idempotencyKey: `${input.clientOpId}:${slab.id}`,
            actorId: user.id,
          },
        });
      }

      const order = await tx.salesOrder.create({
        data: {
          factoryId: user.factoryId,
          customerId: input.customerId,
          status: "CONFIRMED",
          billingMode: input.billingMode ?? "gst_invoice",
          orderDate: new Date(input.orderDate),
          lines: { create: input.lines },
        },
        include: { lines: true, customer: true },
      });
      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId: input.clientOpId,
          actorId: user.id,
          method: "POST",
          path: "/api/v1/sales-orders",
          requestHash: input.clientOpId,
          statusCode: 201,
          response: order as unknown as Prisma.InputJsonValue,
        },
      });
      return order;
    });
  }

  async pack(user: AuthenticatedUser, salesOrderId: string, slabIds: string[]) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
      const packing = await tx.inventoryLocation.findFirst({
        where: { factoryId: user.factoryId, code: "PACKING" },
      });
      if (!packing) throw new BadRequestException("PACKING location is missing");
      const list = await tx.packingList.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          lines: { create: slabIds.map((slabId) => ({ slabId })) },
        },
        include: { lines: true },
      });
      for (const slabId of slabIds) {
        await tx.slab.update({
          where: { id: slabId },
          data: { locationId: packing.id, version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "PACKING",
            slabId,
            quantity: 1,
            idempotencyKey: `pack:${list.id}:${slabId}`,
            actorId: user.id,
          },
        });
      }
      return list;
    });
  }

  async dispatch(
    user: AuthenticatedUser,
    salesOrderId: string,
    slabIds: string[],
    extra?: { clientOpId?: string; vehicleId?: string; ewayDraftId?: string; invoiceId?: string },
  ) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    const clientOpId = extra?.clientOpId ?? `dispatch:${salesOrderId}`;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.syncOperation.findUnique({
        where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } },
      });
      if (existing) return existing.response;
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
      const packing = await tx.inventoryLocation.findFirst({
        where: { factoryId: user.factoryId, code: "PACKING" },
      });
      const deliveredLoc = await tx.inventoryLocation.findFirst({
        where: { factoryId: user.factoryId, code: "DELIVERED" },
      });
      if (!packing || !deliveredLoc) throw new BadRequestException("PACKING or DELIVERED location is missing");
      for (const slabId of slabIds) {
        const slab = await tx.slab.findFirst({ where: { id: slabId, factoryId: user.factoryId } });
        if (!slab) throw new BadRequestException("Slab does not belong to this factory");
        if (slab.locationId !== packing.id) {
          throw new BadRequestException("Slab must be in PACKING before dispatch");
        }
        if (slab.salesStatus === "dispatched") {
          throw new BadRequestException("Slab is already dispatched");
        }
      }
      const delivery = await tx.delivery.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          dispatchedAt: new Date(),
          lines: { create: slabIds.map((slabId) => ({ slabId })) },
        },
        include: { lines: true },
      });
      for (const slabId of slabIds) {
        await tx.slab.update({
          where: { id: slabId },
          data: { salesStatus: "dispatched", locationId: deliveredLoc.id, version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "DISPATCH",
            slabId,
            quantity: 1,
            idempotencyKey: `${clientOpId}:${slabId}`,
            actorId: user.id,
            notes: extra?.ewayDraftId ? `eway:${extra.ewayDraftId}` : extra?.invoiceId,
          },
        });
      }
      const response = delivery as unknown as Prisma.InputJsonValue;
      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId,
          actorId: user.id,
          method: "POST",
          path: `/api/v1/sales-orders/${salesOrderId}/dispatch`,
          requestHash: clientOpId,
          statusCode: 201,
          response,
        },
      });
      return delivery;
    });
  }

  async invoice(
    user: AuthenticatedUser,
    salesOrderId: string,
    clientOpId: string,
    charges: Array<{ label: string; amount: number; taxable?: boolean }> = [],
  ) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    if (order.billingMode === "cash_unbilled") {
      throw new BadRequestException("This order is a cash sale; it cannot be invoiced");
    }
    const cleanCharges = charges.map((c) => {
      const label = c.label?.trim();
      if (!label) throw new BadRequestException("Every charge needs a label");
      if (!Number.isFinite(c.amount) || c.amount <= 0) {
        throw new BadRequestException(`Charge "${label}" must be a positive amount`);
      }
      return { label, amount: c.amount, taxable: c.taxable !== false };
    });
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { factoryId_idempotencyKey: { factoryId: user.factoryId, idempotencyKey: clientOpId } },
      });
      if (existing) return existing;
      const duplicate = await tx.invoice.findFirst({ where: { salesOrderId: order.id } });
      if (duplicate) throw new BadRequestException("Order already invoiced");
      const lines = await tx.salesLineItem.findMany({ where: { salesOrderId: order.id } });
      // Rates are quoted ex-GST, so this sum is the taxable value, not the payable.
      const lineTotal = lines.reduce((sum, line) => sum + Number(line.quantitySqft) * Number(line.rate), 0);
      // Packaging, demurrage, labour and the like are part of the transaction value,
      // so they are taxed with the slabs unless explicitly billed as a reimbursement.
      const chargeTaxable = cleanCharges.filter((c) => c.taxable).reduce((sum, c) => sum + c.amount, 0);
      const chargeExempt = cleanCharges.filter((c) => !c.taxable).reduce((sum, c) => sum + c.amount, 0);
      const taxable = lineTotal + chargeTaxable;
      const customer = await tx.customer.findFirst({
        where: { id: order.customerId, factoryId: user.factoryId },
      });
      const gst = await this.resolveGst(tx, user.factoryId, taxable, customer);
      const amount = minorToRupees(gst.totalMinor + rupeesToMinor(chargeExempt));
      const invoiceNumber = await nextDocumentNumber(tx, user.factoryId, "INVOICE");
      try {
        const created = await tx.invoice.create({
          data: {
            factoryId: user.factoryId,
            salesOrderId: order.id,
            customerId: order.customerId,
            invoiceNumber,
            amount,
            taxableAmount: minorToRupees(gst.taxableMinor),
            cgstAmount: minorToRupees(gst.cgstMinor),
            sgstAmount: minorToRupees(gst.sgstMinor),
            igstAmount: minorToRupees(gst.igstMinor),
            exemptAmount: chargeExempt,
            gstRatePct: gst.ratePct,
            placeOfSupply: gst.placeOfSupply,
            supplierState: gst.supplierState,
            idempotencyKey: clientOpId,
            charges: { create: cleanCharges },
          },
          include: { charges: true },
        });
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "sales.invoice",
            entityType: "invoice",
            entityId: created.id,
            payload: {
              amount,
              taxable,
              lineTotal,
              charges: cleanCharges,
              invoiceNumber,
              gstRatePct: gst.ratePct,
            },
          },
        });
        await this.books.postInvoice(tx, user, {
          invoiceId: created.id,
          customerName: customer?.name ?? "Unknown",
          gst,
          exemptMinor: rupeesToMinor(chargeExempt),
          clientOpId,
        });
        return created;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException("Invoice number already issued; retry the same clientOpId");
        }
        throw error;
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  async pay(
    user: AuthenticatedUser,
    invoiceId: string,
    input: { amount: number; method: string; paidAt: string; clientOpId: string; baseVersion?: number },
  ) {
    if (input.amount <= 0) throw new BadRequestException("Amount must be positive");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoice WHERE id = ${invoiceId} AND factory_id = ${user.factoryId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, factoryId: user.factoryId },
        include: { payments: true, creditNotes: true },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      if (input.baseVersion != null && invoice.version !== input.baseVersion) {
        throw new ConflictException({
          code: "VERSION_CONFLICT",
          serverVersion: invoice.version,
          server: invoice,
        });
      }
      const existing = await tx.payment.findUnique({
        where: { factoryId_idempotencyKey: { factoryId: user.factoryId, idempotencyKey: input.clientOpId } },
      });
      if (existing) return existing;
      const paid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const credited = invoice.creditNotes.reduce((sum, n) => sum + Number(n.amount), 0);
      if (paid + input.amount > Number(invoice.amount) - credited + 0.001) {
        throw new BadRequestException("Payment exceeds invoice amount");
      }
      try {
        const payment = await tx.payment.create({
          data: {
            factoryId: user.factoryId,
            invoiceId: invoice.id,
            amount: input.amount,
            method: input.method,
            paidAt: parseFactoryDateInput(input.paidAt),
            idempotencyKey: input.clientOpId,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { version: { increment: 1 } },
        });
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "sales.payment",
            entityType: "payment",
            entityId: payment.id,
            payload: { invoiceId: invoice.id, amount: input.amount },
          },
        });
        const customer = await tx.customer.findFirst({
          where: { id: invoice.customerId, factoryId: user.factoryId },
        });
        await this.books.postPayment(tx, user, {
          paymentId: payment.id,
          invoiceId: invoice.id,
          customerName: customer?.name ?? "Unknown",
          amount: input.amount,
          method: input.method,
          clientOpId: input.clientOpId,
          paidAt: parseFactoryDateInput(input.paidAt),
        });
        return payment;
      } catch (error) {
        if (String(error).includes("Payment exceeds invoice amount")) {
          throw new BadRequestException("Payment exceeds invoice amount");
        }
        throw error;
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  /**
   * Settle an order as a cash counter sale: no invoice, no GST document, nothing in
   * GSTR-1. The stock has still left the yard and the cash has still arrived, so both
   * are recorded and the revenue sits on its own ledger.
   *
   * This records a decision; it does not discharge a liability. Under GST a taxable
   * supply is taxable whether or not an invoice was raised.
   */
  async recordCashSale(
    user: AuthenticatedUser,
    salesOrderId: string,
    input: { amount: number; saleDate: string; clientOpId: string; buyerName?: string; note?: string },
  ) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException("Amount must be positive");
    }
    if (!input.clientOpId) throw new BadRequestException("clientOpId is required");
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    if (order.billingMode !== "cash_unbilled") {
      throw new BadRequestException("Order is not marked as a cash sale");
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.cashSale.findUnique({
        where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId } },
      });
      if (existing) return existing;
      const invoiced = await tx.invoice.findFirst({ where: { salesOrderId: order.id } });
      if (invoiced) throw new BadRequestException("Order is already invoiced");

      const sale = await tx.cashSale.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          buyerName: input.buyerName?.trim() || null,
          amount: input.amount,
          saleDate: parseFactoryDateInput(input.saleDate),
          note: input.note?.trim() || null,
          clientOpId: input.clientOpId,
          recordedBy: user.id,
        },
      });
      await this.books.postCashSale(tx, user, {
        cashSaleId: sale.id,
        amountMinor: rupeesToMinor(input.amount),
        memo: `Cash sale${input.buyerName ? ` to ${input.buyerName.trim()}` : ""} (no invoice)`,
        clientOpId: `cashsale:${input.clientOpId}`,
        saleDate: parseFactoryDateInput(input.saleDate),
      });
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "sales.cash_sale",
          entityType: "cash_sale",
          entityId: sale.id,
          payload: {
            salesOrderId: order.id,
            amount: input.amount,
            buyerName: input.buyerName ?? null,
            unbilled: true,
          },
        },
      });
      return sale;
    });
  }

  async returnSlabs(user: AuthenticatedUser, salesOrderId: string, slabIds: string[], reason: string) {
    if (!reason?.trim()) throw new BadRequestException("Reason is required");
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
      const invoice = await tx.invoice.findFirst({ where: { salesOrderId: order.id } });
      const lines = await tx.salesLineItem.findMany({
        where: { salesOrderId: order.id, slabId: { in: slabIds } },
      });
      const creditTaxable = lines.reduce(
        (sum, line) => sum + Number(line.quantitySqft) * Number(line.rate),
        0,
      );
      if (invoice && creditTaxable <= 0) {
        throw new BadRequestException("Invoiced return needs a credit amount from order lines");
      }
      for (const slabId of slabIds) {
        const slab = await tx.slab.findFirst({ where: { id: slabId, factoryId: user.factoryId } });
        if (!slab) throw new BadRequestException("Slab does not belong to this factory");
        if (slab.salesStatus !== "sold" && slab.salesStatus !== "reserved" && slab.salesStatus !== "dispatched") {
          throw new BadRequestException("Slab is not outbound stock for this order");
        }
      }
      const ret = await tx.customerReturn.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          reason: reason.trim(),
          lines: { create: slabIds.map((slabId) => ({ slabId })) },
        },
        include: { lines: true },
      });
      let creditNote = null;
      if (invoice) {
        const creditNoteNumber = await nextDocumentNumber(tx, user.factoryId, "CREDIT_NOTE");
        // Reverse the tax on the same heads the invoice charged, so a cross-state sale
        // credits IGST and a local one credits CGST + SGST.
        const creditCustomer = await tx.customer.findFirst({
          where: { id: order.customerId, factoryId: user.factoryId },
        });
        const creditGst = await this.resolveGst(tx, user.factoryId, creditTaxable, creditCustomer);
        try {
          creditNote = await tx.creditNote.create({
            data: {
              factoryId: user.factoryId,
              salesOrderId: order.id,
              invoiceId: invoice.id,
              customerReturnId: ret.id,
              creditNoteNumber,
              amount: minorToRupees(creditGst.totalMinor),
              taxableAmount: minorToRupees(creditGst.taxableMinor),
              cgstAmount: minorToRupees(creditGst.cgstMinor),
              sgstAmount: minorToRupees(creditGst.sgstMinor),
              igstAmount: minorToRupees(creditGst.igstMinor),
              gstRatePct: creditGst.ratePct,
              placeOfSupply: creditGst.placeOfSupply,
              supplierState: creditGst.supplierState,
              reason: reason.trim(),
              idempotencyKey: `credit:${ret.id}`,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictException("Credit note number already issued");
          }
          throw error;
        }
        await this.books.postCreditNote(tx, user, {
          creditNoteId: creditNote.id,
          invoiceId: invoice.id,
          customerName: creditCustomer?.name ?? "Unknown",
          gst: creditGst,
          clientOpId: `credit:${ret.id}`,
        });
      }
      for (const slabId of slabIds) {
        await tx.slab.update({
          where: { id: slabId },
          data: { salesStatus: "in_stock", version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "RETURN",
            slabId,
            quantity: 1,
            idempotencyKey: `return:${ret.id}:${slabId}`,
            actorId: user.id,
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "sales.return",
          entityType: "customer_return",
          entityId: ret.id,
          payload: {
            reason: reason.trim(),
            slabIds,
            creditNoteNumber: creditNote?.creditNoteNumber,
            creditAmount: creditNote ? Number(creditNote.amount) : 0,
          },
        },
      });
      return { ...ret, creditNote };
    });
  }

  async recovery(factoryId: string) {
    const blocks = await this.prisma.rawBlock.findMany({
      where: { factoryId },
      include: { slabs: { include: { orderLines: { include: { salesOrder: true } } } } },
    });
    return blocks.map((block) => {
      const soldSqft = block.slabs
        .flatMap((s) => s.orderLines)
        .filter((line) => line.salesOrder.status === "CONFIRMED" || line.salesOrder.status === "PARTIALLY_DELIVERED" || line.salesOrder.status === "DELIVERED")
        .reduce((sum, line) => sum + Number(line.quantitySqft), 0);
      const tons = Number(block.weightTons ?? 0);
      return {
        serialNumber: block.serialNumber,
        soldSqft,
        weightTons: tons,
        ratio: recoveryRatio(soldSqft, tons),
      };
    });
  }

  /**
   * Resolve the tax on a taxable value at the moment a document is issued.
   * The supplier state comes from the GSTIN itself, so a mistyped stateCode on the
   * profile can never route tax to the wrong heads.
   */
  private async resolveGst(
    tx: Prisma.TransactionClient,
    factoryId: string,
    taxableRupees: number,
    customer: { stateCode?: string | null; gstin?: string | null } | null,
  ) {
    const profile = await tx.gstProfile.findUnique({ where: { factoryId } });
    const supplierStateCode = profile
      ? (stateCodeFromGstin(profile.gstin) ?? profile.stateCode)
      : null;
    const placeOfSupplyStateCode =
      customer?.stateCode ?? (customer?.gstin ? stateCodeFromGstin(customer.gstin) : null);
    return gstOnTaxable(rupeesToMinor(taxableRupees), {
      supplierStateCode,
      placeOfSupplyStateCode,
      registered: Boolean(profile),
    });
  }

  private async assertCustomer(factoryId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, factoryId } });
    if (!customer) throw new BadRequestException("Customer does not belong to this factory");
  }

  private async requireOrder(factoryId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id, factoryId } });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }
}
