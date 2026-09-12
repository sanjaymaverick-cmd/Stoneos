import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export function orderedFactoryPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function assertLinked(
  tx: Prisma.TransactionClient,
  factoryId: string,
  sisterId: string,
) {
  const [a, b] = orderedFactoryPair(factoryId, sisterId);
  const link = await tx.interfactoryLink.findUnique({
    where: { factoryAId_factoryBId: { factoryAId: a, factoryBId: b } },
  });
  if (!link) throw new BadRequestException("Factories are not linked for interfactory trade");
  return link;
}

export async function postPayableForInvoice(
  tx: Prisma.TransactionClient,
  input: {
    buyerFactoryId: string;
    sellerFactoryId: string;
    invoiceId: string;
    amount: number;
  },
) {
  await assertLinked(tx, input.buyerFactoryId, input.sellerFactoryId);
  return tx.interfactoryPayable.create({
    data: {
      factoryId: input.buyerFactoryId,
      sellerFactoryId: input.sellerFactoryId,
      sourceInvoiceId: input.invoiceId,
      amount: input.amount,
    },
  });
}

export async function remainingPayable(tx: Prisma.TransactionClient, payableId: string) {
  const payable = await tx.interfactoryPayable.findUnique({
    where: { id: payableId },
    include: { settlements: true },
  });
  if (!payable) return null;
  const settled = payable.settlements.reduce((sum, s) => sum + Number(s.amount), 0);
  return {
    payable,
    remaining: Number(payable.amount) - Number(payable.creditedAmount) - settled,
  };
}

export async function recordSettlement(
  tx: Prisma.TransactionClient,
  input: {
    buyerFactoryId: string;
    payableId: string;
    amount: number;
    method: string;
    paidAt: Date;
    clientOpId: string;
    sellerPaymentId?: string;
  },
) {
  const existing = await tx.interfactorySettlement.findUnique({
    where: {
      factoryId_idempotencyKey: { factoryId: input.buyerFactoryId, idempotencyKey: input.clientOpId },
    },
  });
  if (existing) return existing;
  const state = await remainingPayable(tx, input.payableId);
  if (!state) throw new BadRequestException("Interfactory payable not found");
  if (input.amount > state.remaining + 0.001) {
    throw new BadRequestException("Settlement exceeds payable amount");
  }
  return tx.interfactorySettlement.create({
    data: {
      factoryId: input.buyerFactoryId,
      payableId: input.payableId,
      sellerPaymentId: input.sellerPaymentId,
      amount: input.amount,
      method: input.method,
      paidAt: input.paidAt,
      idempotencyKey: input.clientOpId,
    },
  });
}
