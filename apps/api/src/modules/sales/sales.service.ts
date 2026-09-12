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

@Injectable()
export class SalesService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
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
        if (slab.salesStatus === "sold" || slab.salesStatus === "reserved") {
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
    await this.assertFactorySlabs(this.prisma, user.factoryId, slabIds, order.id);
    return this.prisma.packingList.create({
      data: {
        factoryId: user.factoryId,
        salesOrderId: order.id,
        lines: { create: slabIds.map((slabId) => ({ slabId })) },
      },
      include: { lines: true },
    });
  }

  async dispatch(user: AuthenticatedUser, salesOrderId: string, slabIds: string[]) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      await this.assertFactorySlabs(tx, user.factoryId, slabIds, order.id);
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
          data: { salesStatus: "sold", version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "DELIVERY",
            slabId,
            quantity: 1,
            idempotencyKey: `dispatch:${delivery.id}:${slabId}`,
            actorId: user.id,
          },
        });
      }
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
          },
        });
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "sales.invoice",
            entityType: "invoice",
            entityId: created.id,
            payload: { amount, invoiceNumber },
          },
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
            paidAt: new Date(input.paidAt),
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
        if (slab.salesStatus !== "sold" && slab.salesStatus !== "reserved") {
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
