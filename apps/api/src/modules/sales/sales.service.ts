import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { recoveryRatio } from "@stoneos/domain";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { parseOccurredAt } from "../../common/occurred-at";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { assertAllowedRoles } from "../../common/session.guard";
import { PAYMENT_ROLES, type Role } from "@stoneos/contracts";
import { isUniqueViolation, nextDocumentNumber } from "./document-number";
import { BooksService } from "../books/books.service";
import {
  GST_DEFAULTS,
  gstOnTaxable,
  minorToRupees,
  normaliseStateCode,
  parseBusinessDate,
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

  async orders(factoryId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: { factoryId },
      include: {
        customer: true,
        lines: {include:{slab:{include:{location:true}}}},
        invoices: { include: { payments: true, creditNotes: true } },
        deliveries: {include:{lines:true}},
        packingLists: true,
      },
      orderBy: { createdAt: "desc" },
    });
    // Derive historic dispatch state without rewriting existing rows.
    return orders.map(o=>{const ids=o.lines.map(l=>l.slabId).filter(Boolean);const delivered=new Set(o.deliveries.flatMap(d=>d.lines.map(l=>l.slabId)));return {...o,status:o.deliveries.length ? ids.every(id=>delivered.has(id!)) ? "DELIVERED" : "PARTIALLY_DELIVERED" : o.status};});
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
      lines: Array<{
        slabId?: string;
        description: string;
        quantitySqft: number;
        rate: number;
      }>;
    },
  ) {
    await this.assertCustomer(user.factoryId, input.customerId);
    await this.assertFactorySlabs(
      this.prisma,
      user.factoryId,
      input.lines.map((l) => l.slabId),
    );
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
      lines: Array<{
        slabId?: string;
        quantitySqft: number;
        rate: number;
        baseVersion?: number;
      }>;
      clientOpId: string;
      billingMode?: "gst_invoice" | "cash_unbilled";
      /**
       * Keep the order for whatever slabs are still free instead of refusing it whole.
       * Set by devices replaying an order taken offline: by the time it syncs, a
       * colleague who was online may have sold one of its slabs, and the first to the
       * server wins. Every slab left out is listed in `droppedSlabs`.
       */
      partial?: boolean;
    },
  ) {
    await this.assertCustomer(user.factoryId, input.customerId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.syncOperation.findUnique({
        where: {
          factoryId_clientOpId: {
            factoryId: user.factoryId,
            clientOpId: input.clientOpId,
          },
        },
      });
      if (existing) return existing.response;

      const kept: typeof input.lines = [];
      const droppedSlabs: Array<{
        slabId: string;
        slabSerial: string;
        reason: string;
      }> = [];
      for (const line of input.lines) {
        if (!line.slabId) {
          kept.push(line);
          continue;
        }
        const slab = await tx.slab.findFirst({
          where: { id: line.slabId, factoryId: user.factoryId },
          include: { location: true },
        });
        if (!slab)
          throw new BadRequestException("Slab does not belong to this factory");
        const refusal =
          slab.salesStatus === "sold" ||
          slab.salesStatus === "reserved" ||
          slab.salesStatus === "dispatched"
            ? `Slab ${slab.slabSerial} is not available`
            : slab.location?.code === "UNPOLISHED_STOCK"
              ? `Slab ${slab.slabSerial} has not been polished yet`
              : line.baseVersion != null && slab.version !== line.baseVersion
                ? `Slab ${slab.slabSerial} changed since it was picked`
                : null;
        if (refusal) {
          if (input.partial) {
            droppedSlabs.push({
              slabId: slab.id,
              slabSerial: slab.slabSerial,
              reason: refusal,
            });
            continue;
          }
          if (line.baseVersion != null && slab.version !== line.baseVersion) {
            throw new ConflictException({
              code: "VERSION_CONFLICT",
              serverVersion: slab.version,
              server: slab,
            });
          }
          throw new BadRequestException(refusal);
        }
        kept.push(line);
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

      if (kept.length === 0) {
        throw new ConflictException({
          code: "SLABS_UNAVAILABLE",
          message:
            "Every slab on this order was sold or changed by someone else first",
          droppedSlabs,
        });
      }
      const created = await tx.salesOrder.create({
        data: {
          factoryId: user.factoryId,
          customerId: input.customerId,
          status: "CONFIRMED",
          billingMode: input.billingMode ?? "gst_invoice",
          orderDate: parseBusinessDate(input.orderDate, "orderDate"),
          lines: {
            create: kept.map(({ slabId, quantitySqft, rate }) => ({
              slabId,
              quantitySqft,
              rate,
            })),
          },
        },
        include: { lines: true, customer: true },
      });
      const order = { ...created, droppedSlabs };
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

  async pack(
    user: AuthenticatedUser,
    salesOrderId: string,
    requested: string[],
    partial = false,
  ) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      let slabIds = requested;
      let skippedSlabs: string[] = [];
      if (partial) {
        // A replayed offline order may have lost slabs to someone faster; pack what it kept.
        const onOrder = await tx.salesLineItem.findMany({
          where: { salesOrderId: order.id, slabId: { in: requested } },
          include: { slab: true },
        });
        const packable = new Set(
          onOrder
            .filter((line) => line.slab?.salesStatus === "reserved")
            .map((line) => line.slabId as string),
        );
        slabIds = requested.filter((id) => packable.has(id));
        skippedSlabs = requested.filter((id) => !packable.has(id));
        if (slabIds.length === 0) {
          throw new ConflictException({
            code: "SLABS_UNAVAILABLE",
            message: "No slab left to pack",
            skippedSlabs,
          });
        }
      }
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
      const packing = await tx.inventoryLocation.findFirst({
        where: { factoryId: user.factoryId, code: "PACKING" },
      });
      if (!packing)
        throw new BadRequestException("PACKING location is missing");
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
      return partial ? { ...list, skippedSlabs } : list;
    });
  }

  async dispatch(
    user: AuthenticatedUser,
    salesOrderId: string,
    requested: string[],
    extra?: {
      clientOpId?: string;
      vehicleId?: string;
      ewayDraftId?: string;
      invoiceId?: string;
      partial?: boolean;
      occurredAt?: string;
    },
  ) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    // Which slabs are going identifies the load. Keying on the order alone made the
    // second lorry a replay of the first: it returned the first delivery and shipped
    // nothing, leaving half the order in PACKING while the books showed it gone.
    const loadHash = hashSlabLoad(requested);
    const clientOpId = extra?.clientOpId ?? `dispatch:${salesOrderId}:${loadHash}`;
    const dispatchedAt = parseOccurredAt(extra?.occurredAt);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.syncOperation.findUnique({
        where: {
          factoryId_clientOpId: { factoryId: user.factoryId, clientOpId },
        },
      });
      if (existing) {
        // A caller-supplied key reused for a different load is a client bug. Handing
        // back the earlier load's response is how the fault above stayed invisible,
        // so refuse it instead of answering the wrong question.
        // Rows written before this field carried a load hash stored the key itself.
        // Replay those as they always were, so a device syncing a dispatch from
        // across the upgrade is not met with a conflict on work it already did.
        const legacyRow = existing.requestHash === clientOpId;
        if (!legacyRow && existing.requestHash !== loadHash) {
          throw new ConflictException({
            code: "CLIENT_OP_ID_REUSED",
            message: "This clientOpId was already used for a different request",
          });
        }
        return existing.response;
      }
      const packing = await tx.inventoryLocation.findFirst({
        where: { factoryId: user.factoryId, code: "PACKING" },
      });
      let slabIds = requested;
      let skippedSlabs: string[] = [];
      if (extra?.partial) {
        const onOrder = await tx.salesLineItem.findMany({
          where: { salesOrderId: order.id, slabId: { in: requested } },
          include: { slab: true },
        });
        const shippable = new Set(
          onOrder
            .filter(
              (line) =>
                line.slab?.locationId === packing?.id &&
                line.slab?.salesStatus !== "dispatched",
            )
            .map((line) => line.slabId as string),
        );
        slabIds = requested.filter((id) => shippable.has(id));
        skippedSlabs = requested.filter((id) => !shippable.has(id));
        if (slabIds.length === 0) {
          throw new ConflictException({
            code: "SLABS_UNAVAILABLE",
            message: "No packed slab left to dispatch",
            skippedSlabs,
          });
        }
      }
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
      const deliveredLoc = await tx.inventoryLocation.findFirst({
        where: { factoryId: user.factoryId, code: "DELIVERED" },
      });
      if (!packing || !deliveredLoc)
        throw new BadRequestException(
          "PACKING or DELIVERED location is missing",
        );
      for (const slabId of slabIds) {
        const slab = await tx.slab.findFirst({
          where: { id: slabId, factoryId: user.factoryId },
        });
        if (!slab)
          throw new BadRequestException("Slab does not belong to this factory");
        if (slab.locationId !== packing.id) {
          throw new BadRequestException(
            "Slab must be in PACKING before dispatch",
          );
        }
        if (slab.salesStatus === "dispatched") {
          throw new BadRequestException("Slab is already dispatched");
        }
      }
      const delivery = await tx.delivery.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          dispatchedAt,
          lines: { create: slabIds.map((slabId) => ({ slabId })) },
        },
        include: { lines: true },
      });
      for (const slabId of slabIds) {
        await tx.slab.update({
          where: { id: slabId },
          data: {
            salesStatus: "dispatched",
            locationId: deliveredLoc.id,
            version: { increment: 1 },
          },
        });
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "DISPATCH",
            slabId,
            quantity: 1,
            idempotencyKey: `${clientOpId}:${slabId}`,
            actorId: user.id,
            notes: extra?.ewayDraftId
              ? `eway:${extra.ewayDraftId}`
              : extra?.invoiceId,
          },
        });
      }
      await this.advanceDeliveryStatus(tx, order.id);
      const result = extra?.partial ? { ...delivery, skippedSlabs } : delivery;
      const response = result as unknown as Prisma.InputJsonValue;
      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId,
          actorId: user.id,
          method: "POST",
          path: `/api/v1/sales-orders/${salesOrderId}/dispatch`,
          requestHash: loadHash,
          statusCode: 201,
          response,
        },
      });
      return result;
    });
  }

  async invoice(
    user: AuthenticatedUser,
    salesOrderId: string,
    clientOpId: string,
    charges: Array<{ label: string; amount: number; taxable?: boolean }> = [],
    /** Statutory slab for this supply. Defaults to 18% for finished slabs (HSN 6802). */
    gstRatePct?: number,
  ) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    if (order.billingMode === "cash_unbilled") {
      throw new BadRequestException(
        "This order is a cash sale; it cannot be invoiced",
      );
    }
    const cleanCharges = charges.map((c) => {
      const label = c.label?.trim();
      if (!label) throw new BadRequestException("Every charge needs a label");
      if (!Number.isFinite(c.amount) || c.amount <= 0) {
        throw new BadRequestException(
          `Charge "${label}" must be a positive amount`,
        );
      }
      return { label, amount: c.amount, taxable: c.taxable !== false };
    });
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.invoice.findUnique({
          where: {
            factoryId_idempotencyKey: {
              factoryId: user.factoryId,
              idempotencyKey: clientOpId,
            },
          },
        });
        if (existing) return existing;
        const duplicate = await tx.invoice.findFirst({
          where: { salesOrderId: order.id },
        });
        if (duplicate) throw new BadRequestException("Order already invoiced");
        const lines = await tx.salesLineItem.findMany({
          where: { salesOrderId: order.id },
        });
        // Rates are quoted ex-GST, so this sum is the taxable value, not the payable.
        const lineTotal = lines.reduce(
          (sum, line) => sum + Number(line.quantitySqft) * Number(line.rate),
          0,
        );
        // Packaging, demurrage, labour and the like are part of the transaction value,
        // so they are taxed with the slabs unless explicitly billed as a reimbursement.
        const chargeTaxable = cleanCharges
          .filter((c) => c.taxable)
          .reduce((sum, c) => sum + c.amount, 0);
        const chargeExempt = cleanCharges
          .filter((c) => !c.taxable)
          .reduce((sum, c) => sum + c.amount, 0);
        const taxable = lineTotal + chargeTaxable;
        const customer = await tx.customer.findFirst({
          where: { id: order.customerId, factoryId: user.factoryId },
        });
        const gst = await this.resolveGst(
          tx,
          user.factoryId,
          taxable,
          customer,
          gstRatePct,
        );
        const amount = minorToRupees(
          gst.totalMinor + rupeesToMinor(chargeExempt),
        );
        const invoiceNumber = await nextDocumentNumber(
          tx,
          user.factoryId,
          "INVOICE",
        );
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
            throw new ConflictException(
              "Invoice number already issued; retry the same clientOpId",
            );
          }
          throw error;
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  async pay(
    user: AuthenticatedUser,
    invoiceId: string,
    input: {
      amount: number;
      method: string;
      paidAt: string;
      clientOpId: string;
      baseVersion?: number;
    },
  ) {
    // Backstop, not the primary gate. The route carries PAYMENT_ROLES, but this method
    // is also reached from intake confirmation, where the caller's role is whatever the
    // confirmer happens to hold. Asserting here means no future caller can widen who
    // may settle an invoice by accident.
    assertAllowedRoles(PAYMENT_ROLES, user.role as Role);
    if (input.amount <= 0)
      throw new BadRequestException("Amount must be positive");
    const paidAt = parseBusinessDate(input.paidAt, "paidAt");
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM invoice WHERE id = ${invoiceId} AND factory_id = ${user.factoryId} FOR UPDATE`;
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, factoryId: user.factoryId },
          include: { payments: true, creditNotes: true },
        });
        if (!invoice) throw new NotFoundException("Invoice not found");
        if (
          input.baseVersion != null &&
          invoice.version !== input.baseVersion
        ) {
          throw new ConflictException({
            code: "VERSION_CONFLICT",
            serverVersion: invoice.version,
            server: invoice,
          });
        }
        const existing = await tx.payment.findUnique({
          where: {
            factoryId_idempotencyKey: {
              factoryId: user.factoryId,
              idempotencyKey: input.clientOpId,
            },
          },
        });
        if (existing) return existing;
        const paid = invoice.payments.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        );
        const credited = invoice.creditNotes.reduce(
          (sum, n) => sum + Number(n.amount),
          0,
        );
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
              paidAt,
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
            paidAt,
          });
          return payment;
        } catch (error) {
          if (String(error).includes("Payment exceeds invoice amount")) {
            throw new BadRequestException("Payment exceeds invoice amount");
          }
          throw error;
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
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
    input: {
      amount: number;
      saleDate: string;
      clientOpId: string;
      buyerName?: string;
      note?: string;
    },
  ) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException("Amount must be positive");
    }
    if (!input.clientOpId)
      throw new BadRequestException("clientOpId is required");
    const saleDate = parseBusinessDate(input.saleDate, "saleDate");
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    if (order.billingMode !== "cash_unbilled") {
      throw new BadRequestException("Order is not marked as a cash sale");
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.cashSale.findUnique({
        where: {
          factoryId_clientOpId: {
            factoryId: user.factoryId,
            clientOpId: input.clientOpId,
          },
        },
      });
      if (existing) return existing;
      const invoiced = await tx.invoice.findFirst({
        where: { salesOrderId: order.id },
      });
      if (invoiced) throw new BadRequestException("Order is already invoiced");

      const sale = await tx.cashSale.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          buyerName: input.buyerName?.trim() || null,
          amount: input.amount,
          saleDate,
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
        saleDate,
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

  async returnSlabs(
    user: AuthenticatedUser,
    salesOrderId: string,
    slabIds: string[],
    reason: string,
  ) {
    if (!reason?.trim()) throw new BadRequestException("Reason is required");
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
      const invoice = await tx.invoice.findFirst({
        where: { salesOrderId: order.id },
      });
      const lines = await tx.salesLineItem.findMany({
        where: { salesOrderId: order.id, slabId: { in: slabIds } },
      });
      const creditTaxable = lines.reduce(
        (sum, line) => sum + Number(line.quantitySqft) * Number(line.rate),
        0,
      );
      if (invoice && creditTaxable <= 0) {
        throw new BadRequestException(
          "Invoiced return needs a credit amount from order lines",
        );
      }
      for (const slabId of slabIds) {
        const slab = await tx.slab.findFirst({
          where: { id: slabId, factoryId: user.factoryId },
        });
        if (!slab)
          throw new BadRequestException("Slab does not belong to this factory");
        if (
          slab.salesStatus !== "sold" &&
          slab.salesStatus !== "reserved" &&
          slab.salesStatus !== "dispatched"
        ) {
          throw new BadRequestException(
            "Slab is not outbound stock for this order",
          );
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
        const creditNoteNumber = await nextDocumentNumber(
          tx,
          user.factoryId,
          "CREDIT_NOTE",
        );
        // Reverse the tax on the same heads the invoice charged, so a cross-state sale
        // credits IGST and a local one credits CGST + SGST.
        const creditCustomer = await tx.customer.findFirst({
          where: { id: order.customerId, factoryId: user.factoryId },
        });
        const creditGst = await this.resolveGst(
          tx,
          user.factoryId,
          creditTaxable,
          creditCustomer,
        );
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
      include: {
        slabs: { include: { orderLines: { include: { salesOrder: true } }, returnLines: { include: { parent: true } } } },
      },
    });
    return blocks
      .filter(
        (block) =>
          block.slabs.length > 0 &&
          block.slabs.every((s) => s.salesStatus === "dispatched"),
      )
      .map((block) => {
        const soldSqft = block.slabs
          .filter(s=>s.salesStatus === "dispatched")
          .flatMap(s=>s.orderLines.filter(l=>!s.returnLines.some(r=>r.parent.salesOrderId===l.salesOrderId)))
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
    ratePct?: number,
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
      ratePct,
      defaultRatePct: GST_DEFAULTS.finishedSlab,
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

  /**
   * Move the order along as its slabs leave the yard: PARTIALLY_DELIVERED while any
   * remain, DELIVERED once the last one has gone.
   *
   * Nothing did this before, so an order that had shipped in full still read
   * CONFIRMED. Every count of open orders, and the CEO brief's order book, was
   * overstated by the whole of the delivered pipeline.
   *
   * Only lines naming a slab can be judged this way. An order carrying none — a
   * quantity-only sale — is left alone rather than declared delivered on no
   * evidence. A cancelled or still-draft order is likewise never moved: the status
   * filter on the update means dispatching against one changes nothing here.
   */
  private async advanceDeliveryStatus(tx: Prisma.TransactionClient, salesOrderId: string) {
    const lines = await tx.salesLineItem.findMany({
      where: { salesOrderId, slabId: { not: null } },
      select: { slab: { select: { salesStatus: true } } },
    });
    if (lines.length === 0) return;

    const shipped = lines.filter((line) => line.slab?.salesStatus === "dispatched").length;
    if (shipped === 0) return;
    const status = shipped === lines.length ? "DELIVERED" : "PARTIALLY_DELIVERED";

    await tx.salesOrder.updateMany({
      where: { id: salesOrderId, status: { in: ["CONFIRMED", "PARTIALLY_DELIVERED"] } },
      data: { status, version: { increment: 1 } },
    });
  }
}

/**
 * A stable fingerprint of the slabs in one load.
 *
 * Order-independent, so the same lorry described in a different sequence is still
 * recognised as the same request, and duplicates in the list do not change it.
 */
function hashSlabLoad(slabIds: readonly string[]): string {
  const canonical = [...new Set(slabIds)].sort().join(",");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
