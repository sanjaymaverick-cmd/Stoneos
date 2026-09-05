import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { recoveryRatio } from "@stoneos/domain";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";

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

  async createQuotation(
    user: AuthenticatedUser,
    input: {
      customerId: string;
      lines: Array<{ slabId?: string; description: string; quantitySqft: number; rate: number }>;
    },
  ) {
    await this.assertCustomer(user.factoryId, input.customerId);
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
      lines: Array<{ slabId?: string; quantitySqft: number; rate: number }>;
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
        const slab = await tx.slab.findFirst({
          where: { id: slabId, factoryId: user.factoryId },
        });
        if (!slab) throw new BadRequestException("Slab not in factory");
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
      const count = await tx.invoice.count({ where: { factoryId: user.factoryId } });
      return tx.invoice.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          customerId: order.customerId,
          invoiceNumber: `INV-${String(count + 1).padStart(5, "0")}`,
          amount,
          idempotencyKey: clientOpId,
        },
      });
    });
  }

  async pay(
    user: AuthenticatedUser,
    invoiceId: string,
    input: { amount: number; method: string; paidAt: string; clientOpId: string },
  ) {
    if (input.amount <= 0) throw new BadRequestException("Amount must be positive");
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, factoryId: user.factoryId },
        include: { payments: true },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      const existing = await tx.payment.findUnique({
        where: { factoryId_idempotencyKey: { factoryId: user.factoryId, idempotencyKey: input.clientOpId } },
      });
      if (existing) return existing;
      const paid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      if (paid + input.amount > Number(invoice.amount) + 0.001) {
        throw new BadRequestException("Payment exceeds invoice amount");
      }
      return tx.payment.create({
        data: {
          factoryId: user.factoryId,
          invoiceId: invoice.id,
          amount: input.amount,
          method: input.method,
          paidAt: new Date(input.paidAt),
          idempotencyKey: input.clientOpId,
        },
      });
    });
  }

  async returnSlabs(user: AuthenticatedUser, salesOrderId: string, slabIds: string[], reason: string) {
    const order = await this.requireOrder(user.factoryId, salesOrderId);
    return this.prisma.$transaction(async (tx) => {
      const ret = await tx.customerReturn.create({
        data: {
          factoryId: user.factoryId,
          salesOrderId: order.id,
          reason,
          lines: { create: slabIds.map((slabId) => ({ slabId })) },
        },
        include: { lines: true },
      });
      for (const slabId of slabIds) {
        const slab = await tx.slab.findFirst({ where: { id: slabId, factoryId: user.factoryId } });
        if (!slab) throw new BadRequestException("Slab not in factory");
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
      return ret;
    });
  }

  async recovery(factoryId: string) {
    const blocks = await this.prisma.rawBlock.findMany({
      where: { factoryId },
      include: { slabs: { include: { orderLines: true } } },
    });
    return blocks.map((block) => {
      const soldSqft = block.slabs
        .flatMap((s) => s.orderLines)
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
