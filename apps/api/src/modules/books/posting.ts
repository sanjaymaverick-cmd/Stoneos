import { BadRequestException } from "@nestjs/common";
import type { Prisma, VoucherSource, VoucherType } from "@prisma/client";
import { operationalDateFor } from "@stoneos/domain";
import { ensureChart } from "./chart";
import { partyNameKey } from "./money";

export type PostLine = { ledgerCode: string; debit: number; credit: number; partyId?: string };

export function assertVoucherLines(lines: PostLine[]) {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit || debit <= 0) {
    throw new BadRequestException("Voucher is not balanced");
  }
  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
      throw new BadRequestException("Voucher line must be debit or credit, not both");
    }
  }
}

export async function postVoucher(
  tx: Prisma.TransactionClient,
  input: {
    factoryId: string;
    type: VoucherType;
    source: VoucherSource;
    clientOpId: string;
    createdBy: string;
    operationalDate?: Date;
    sourceId?: string;
    partyId?: string;
    invoiceId?: string;
    fileId?: string;
    memo?: string;
    lines: PostLine[];
  },
) {
  const existing = await tx.voucher.findUnique({
    where: { factoryId_clientOpId: { factoryId: input.factoryId, clientOpId: input.clientOpId } },
    include: { lines: true },
  });
  if (existing) return existing;

  assertVoucherLines(input.lines);
  const day = operationalDateFor(input.operationalDate ?? new Date());
  if (input.lines.some((l) => l.ledgerCode === "CASH")) {
    const drawer = await tx.cashDrawerDay.findUnique({
      where: { factoryId_operationalDate: { factoryId: input.factoryId, operationalDate: day } },
    });
    if (drawer?.status === "locked") {
      throw new BadRequestException("Cash drawer is locked for this day");
    }
  }

  await ensureChart(tx, input.factoryId);
  const ledgers = await tx.ledger.findMany({ where: { factoryId: input.factoryId } });
  const byCode = new Map(ledgers.map((l) => [l.code, l]));

  const created = await tx.voucher.create({
    data: {
      factoryId: input.factoryId,
      type: input.type,
      source: input.source,
      clientOpId: input.clientOpId,
      createdBy: input.createdBy,
      operationalDate: day,
      sourceId: input.sourceId,
      partyId: input.partyId,
      invoiceId: input.invoiceId,
      fileId: input.fileId,
      memo: input.memo,
      lines: {
        create: input.lines.map((line) => {
          const ledger = byCode.get(line.ledgerCode);
          if (!ledger) throw new BadRequestException(`Unknown ledger ${line.ledgerCode}`);
          return {
            ledgerId: ledger.id,
            partyId: line.partyId,
            debit: line.debit,
            credit: line.credit,
          };
        }),
      },
    },
    include: { lines: true },
  });
  return created;
}

export async function ensureParty(
  tx: Prisma.TransactionClient,
  factoryId: string,
  name: string,
  kind: "customer" | "supplier" | "job" = "customer",
) {
  const nameKey = partyNameKey(name);
  return tx.party.upsert({
    where: { factoryId_nameKey: { factoryId, nameKey } },
    update: { name },
    create: { factoryId, name, nameKey, kind },
  });
}
