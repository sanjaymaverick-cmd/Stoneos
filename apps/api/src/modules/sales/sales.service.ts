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
import { parseFactoryDateInput, shaClientOpId } from "../books/money";
import { postPayableForInvoice, recordSettlement } from "./interfactory-posting";

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

  async createCustomer(user: AuthenticatedUser, name: string, contactInfo?: string) {
    return this.prisma.customer.create({
      data: { factoryId: user.factoryId, name, contactInfo },
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
        });
        if (!slab) throw new BadRequestException("Slab does not belong to this factory");
        if (slab.salesStatus === "sold" || slab.salesStatus === "reserved" || slab.salesStatus === "dispatched") {
          throw new BadRequestException(`Slab ${slab.slabSerial} is not available`);
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

  async invoice(user: AuthenticatedUser, salesOrderId: string, clientOpId: string) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { factoryId_idempotencyKey: { factoryId: user.factoryId, idempotencyKey: clientOpId } },
      });
      if (existing) return existing;
      const duplicate = await tx.invoice.findFirst({ where: { salesOrderId: order.id } });
      if (duplicate) throw new BadRequestException("Order already invoiced");
      const lines = await tx.salesLineItem.findMany({ where: { salesOrderId: order.id } });
      const amount = lines.reduce((sum, line) => sum + Number(line.quantitySqft) * Number(line.rate), 0);
      const customer = await tx.customer.findFirst({
        where: { id: order.customerId, factoryId: user.factoryId },
      });
      const invoiceNumber = await nextDocumentNumber(tx, user.factoryId, "INVOICE");
      try {
        const created = await tx.invoice.create({
          data: {
            factoryId: user.factoryId,
            salesOrderId: order.id,
            customerId: order.customerId,
            invoiceNumber,
            amount,
            idempotencyKey: clientOpId,
            counterpartyFactoryId: customer?.counterpartyFactoryId,
          },
        });
        if (customer?.counterpartyFactoryId) {
          await postPayableForInvoice(tx, {
            buyerFactoryId: customer.counterpartyFactoryId,
            sellerFactoryId: user.factoryId,
            invoiceId: created.id,
            amount,
          });
          const sellerFactory = await tx.factory.findUnique({ where: { id: user.factoryId } });
          await this.books.postSisterPurchase(tx, {
            buyerFactoryId: customer.counterpartyFactoryId,
            actorId: user.id,
            invoiceId: created.id,
            partyName: sellerFactory?.name ?? "Sister plant",
            amount,
            clientOpId: shaClientOpId([customer.counterpartyFactoryId, "if-ap", created.id]),
          });
          const finished = await tx.inventoryLocation.findFirst({
            where: { factoryId: customer.counterpartyFactoryId, code: "FINISHED_STOCK" },
          });
          for (const line of lines) {
            if (!line.slabId) continue;
            const source = await tx.slab.findFirst({
              where: { id: line.slabId, factoryId: user.factoryId },
            });
            if (!source || !finished) continue;
            const copy = await tx.slab.create({
              data: {
                factoryId: customer.counterpartyFactoryId,
                slabSerial: source.slabSerial,
                varietyName: source.varietyName,
                thicknessMm: source.thicknessMm,
                lengthFt: source.lengthFt,
                widthFt: source.widthFt,
                finish: source.finish,
                locationId: finished.id,
                salesStatus: "in_stock",
              },
            });
            await tx.inventoryMovement.create({
              data: {
                factoryId: customer.counterpartyFactoryId,
                movementType: "TRANSFER",
                slabId: copy.id,
                quantity: 1,
                idempotencyKey: shaClientOpId([customer.counterpartyFactoryId, "if-stock", created.id, source.id]),
                actorId: user.id,
                notes: `sister:${user.factoryId}:${source.id}`,
              },
            });
          }
        }
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "sales.invoice",
            entityType: "invoice",
            entityId: created.id,
            payload: { amount, invoiceNumber, counterpartyFactoryId: customer?.counterpartyFactoryId },
          },
        });
        await this.books.postInvoice(tx, user, {
          invoiceId: created.id,
          customerName: customer?.name ?? "Unknown",
          amount,
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
        if (invoice.counterpartyFactoryId) {
          const payable = await tx.interfactoryPayable.findUnique({
            where: { sourceInvoiceId: invoice.id },
          });
          if (payable) {
            await recordSettlement(tx, {
              buyerFactoryId: payable.factoryId,
              payableId: payable.id,
              amount: input.amount,
              method: input.method,
              paidAt: parseFactoryDateInput(input.paidAt),
              clientOpId: input.clientOpId,
              sellerPaymentId: payment.id,
            });
          }
        }
        return payment;
      } catch (error) {
        if (String(error).includes("Payment exceeds invoice amount")) {
          throw new BadRequestException("Payment exceeds invoice amount");
        }
        throw error;
      }
    }, { timeout: 30_000, maxWait: 10_000 });
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
      const creditAmount = lines.reduce(
        (sum, line) => sum + Number(line.quantitySqft) * Number(line.rate),
        0,
      );
      if (invoice && creditAmount <= 0) {
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
        try {
          creditNote = await tx.creditNote.create({
            data: {
              factoryId: user.factoryId,
              salesOrderId: order.id,
              invoiceId: invoice.id,
              customerReturnId: ret.id,
              creditNoteNumber,
              amount: creditAmount,
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
        const customer = await tx.customer.findFirst({
          where: { id: order.customerId, factoryId: user.factoryId },
        });
        await this.books.postCreditNote(tx, user, {
          creditNoteId: creditNote.id,
          invoiceId: invoice.id,
          customerName: customer?.name ?? "Unknown",
          amount: creditAmount,
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
