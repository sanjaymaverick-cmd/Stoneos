import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { isUniqueViolation } from "./document-number";
import { assertLinked, orderedFactoryPair, recordSettlement } from "./interfactory-posting";

@Injectable()
export class InterfactoryService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  listSisters(user: AuthenticatedUser) {
    return this.prisma.factory.findMany({
      where: { id: { not: user.factoryId } },
      select: { id: true, name: true, location: true, operatingStatus: true },
      orderBy: { name: "asc" },
    });
  }

  async link(user: AuthenticatedUser, sisterFactoryId: string) {
    if (!sisterFactoryId || sisterFactoryId === user.factoryId) {
      throw new BadRequestException("Pick a different factory");
    }
    const sister = await this.prisma.factory.findUnique({ where: { id: sisterFactoryId } });
    if (!sister) throw new NotFoundException("Factory not found");
    const self = await this.prisma.factory.findUniqueOrThrow({ where: { id: user.factoryId } });
    const [a, b] = orderedFactoryPair(user.factoryId, sisterFactoryId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.interfactoryLink.findUnique({
        where: { factoryAId_factoryBId: { factoryAId: a, factoryBId: b } },
      });
      if (!existing) {
        await tx.interfactoryLink.create({ data: { factoryAId: a, factoryBId: b } });
      }
      const ours = await tx.customer.upsert({
        where: {
          factoryId_counterpartyFactoryId: {
            factoryId: user.factoryId,
            counterpartyFactoryId: sister.id,
          },
        },
        update: { name: sister.name },
        create: {
          factoryId: user.factoryId,
          name: sister.name,
          counterpartyFactoryId: sister.id,
          contactInfo: "interfactory",
        },
      });
      await tx.customer.upsert({
        where: {
          factoryId_counterpartyFactoryId: {
            factoryId: sister.id,
            counterpartyFactoryId: user.factoryId,
          },
        },
        update: { name: self.name },
        create: {
          factoryId: sister.id,
          name: self.name,
          counterpartyFactoryId: user.factoryId,
          contactInfo: "interfactory",
        },
      });
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "interfactory.link",
          entityType: "interfactory_link",
          entityId: sister.id,
          payload: { sister: sister.name },
        },
      });
      return { linked: true, customer: ours, sister: { id: sister.id, name: sister.name } };
    });
  }

  async positions(user: AuthenticatedUser) {
    const sisters = await this.listSisters(user);
    const customers = await this.prisma.customer.findMany({
      where: { factoryId: user.factoryId, counterpartyFactoryId: { not: null } },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { factoryId: user.factoryId, counterpartyFactoryId: { not: null } },
      include: { payments: true, creditNotes: true },
    });
    const payables = await this.prisma.interfactoryPayable.findMany({
      where: { factoryId: user.factoryId },
      include: { settlements: true },
    });
    return sisters
      .filter((s) => customers.some((c) => c.counterpartyFactoryId === s.id))
      .map((s) => {
        const ar = invoices
          .filter((inv) => inv.counterpartyFactoryId === s.id)
          .reduce((sum, inv) => {
            const paid = inv.payments.reduce((p, row) => p + Number(row.amount), 0);
            const credited = inv.creditNotes.reduce((p, row) => p + Number(row.amount), 0);
            return sum + Number(inv.amount) - credited - paid;
          }, 0);
        const ap = payables
          .filter((p) => p.sellerFactoryId === s.id)
          .reduce((sum, p) => {
            const settled = p.settlements.reduce((x, row) => x + Number(row.amount), 0);
            return sum + Number(p.amount) - Number(p.creditedAmount) - settled;
          }, 0);
        return {
          sisterFactoryId: s.id,
          sisterName: s.name,
          arOutstanding: ar,
          apOutstanding: ap,
          net: ar - ap,
        };
      });
  }

  payables(user: AuthenticatedUser) {
    return this.prisma.interfactoryPayable.findMany({
      where: { factoryId: user.factoryId },
      include: { settlements: true, sellerFactory: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async payPayable(
    user: AuthenticatedUser,
    payableId: string,
    input: { amount: number; method: string; paidAt: string; clientOpId: string },
  ) {
    if (input.amount <= 0) throw new BadRequestException("Amount must be positive");
    if (!input.clientOpId) throw new BadRequestException("clientOpId is required");
    return this.prisma.$transaction(
      async (tx) => {
        const payable = await tx.interfactoryPayable.findFirst({
          where: { id: payableId, factoryId: user.factoryId },
        });
        if (!payable) throw new NotFoundException("Payable not found");
        await assertLinked(tx, user.factoryId, payable.sellerFactoryId);
        await tx.$queryRaw`SELECT id FROM invoice WHERE id = ${payable.sourceInvoiceId} AND factory_id = ${payable.sellerFactoryId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM interfactory_payable WHERE id = ${payable.id} FOR UPDATE`;

        const existingPay = await tx.payment.findUnique({
          where: {
            factoryId_idempotencyKey: {
              factoryId: payable.sellerFactoryId,
              idempotencyKey: input.clientOpId,
            },
          },
        });
        if (existingPay) {
          const existingSet = await tx.interfactorySettlement.findUnique({
            where: {
              factoryId_idempotencyKey: { factoryId: user.factoryId, idempotencyKey: input.clientOpId },
            },
          });
          return { payment: existingPay, settlement: existingSet, idempotent: true };
        }

        const invoice = await tx.invoice.findFirst({
          where: { id: payable.sourceInvoiceId, factoryId: payable.sellerFactoryId },
          include: { payments: true, creditNotes: true },
        });
        if (!invoice) throw new NotFoundException("Seller invoice not found");
        const paid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const credited = invoice.creditNotes.reduce((sum, n) => sum + Number(n.amount), 0);
        if (paid + input.amount > Number(invoice.amount) - credited + 0.001) {
          throw new BadRequestException("Payment exceeds invoice amount");
        }
        const paidAt = new Date(input.paidAt);
        let payment;
        try {
          payment = await tx.payment.create({
            data: {
              factoryId: payable.sellerFactoryId,
              invoiceId: invoice.id,
              amount: input.amount,
              method: input.method,
              paidAt,
              idempotencyKey: input.clientOpId,
            },
          });
        } catch (error) {
          if (String(error).includes("Payment exceeds invoice amount")) {
            throw new BadRequestException("Payment exceeds invoice amount");
          }
          if (isUniqueViolation(error)) {
            throw new ConflictException("Settlement clientOpId already used on seller invoice");
          }
          throw error;
        }
        await tx.invoice.update({ where: { id: invoice.id }, data: { version: { increment: 1 } } });
        const settlement = await recordSettlement(tx, {
          buyerFactoryId: user.factoryId,
          payableId: payable.id,
          amount: input.amount,
          method: input.method,
          paidAt,
          clientOpId: input.clientOpId,
          sellerPaymentId: payment.id,
        });
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "interfactory.settle",
            entityType: "interfactory_settlement",
            entityId: settlement.id,
            payload: { payableId: payable.id, amount: input.amount, sellerInvoiceId: invoice.id },
          },
        });
        return { payment, settlement, idempotent: false };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }
}
