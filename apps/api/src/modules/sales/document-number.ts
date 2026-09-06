import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { formatCreditNoteNumber, formatInvoiceNumber, indianFinancialYear } from "@stoneos/domain";

export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  factoryId: string,
  kind: "INVOICE" | "CREDIT_NOTE",
  at = new Date(),
): Promise<string> {
  const fy = indianFinancialYear(at);
  const rows = await tx.$queryRaw<Array<{ next_number: number }>>`
    INSERT INTO document_sequence (factory_id, kind, fiscal_year, next_number)
    VALUES (${factoryId}, ${kind}, ${fy}, 1)
    ON CONFLICT (factory_id, kind, fiscal_year)
    DO UPDATE SET next_number = document_sequence.next_number + 1
    RETURNING next_number
  `;
  const seq = Number(rows[0]?.next_number);
  if (!Number.isFinite(seq) || seq < 1) {
    throw new ConflictException("Document sequence failed");
  }
  return kind === "INVOICE" ? formatInvoiceNumber(fy, seq) : formatCreditNoteNumber(fy, seq);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
