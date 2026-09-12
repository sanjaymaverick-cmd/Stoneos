import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { FilesService } from "../files/files.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { ensureChart } from "./chart";
import { ensureParty, postVoucher } from "./posting";
import {
  KHATA_AP_TOTAL_MINOR,
  KHATA_AR_TOTAL_MINOR,
  KHATA_CUTOVER,
  KHATA_PARTY_COUNT,
  parseFactoryDate,
  partyNameKey,
  rupeesToMinor,
  shaClientOpId,
} from "./money";
import { classifyPartyKind, looksLikeCashNarrationSplit } from "./khata-parse";
import { previewKhata, type KhataPreview } from "./khata-pdf";

export type { KhataPartyRow } from "./khata-parse";
export { classifyPartyKind, looksLikeCashNarrationSplit, parseKhataList } from "./khata-parse";

@Injectable()
export class KhataService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FilesService) private files: FilesService,
  ) {}

  preview(input: { fileName: string; text?: string; base64?: string }): KhataPreview {
    const bytes = input.base64 ? Buffer.from(input.base64, "base64") : undefined;
    return previewKhata({ fileName: input.fileName, text: input.text, bytes });
  }

  async importList(
    user: AuthenticatedUser,
    input: { fileName: string; body?: string; text?: string; base64?: string; contentType?: string; confirm?: boolean },
  ) {
    const text = input.body ?? input.text ?? "";
    const preview = this.preview({ fileName: input.fileName, text, base64: input.base64 });
    if (preview.kind === "statement") {
      return this.importStatements(user, input, preview);
    }
    const rows = preview.parties;
    if (rows.length === 0) throw new BadRequestException("No parties in khata list");
    for (const row of rows) {
      if (row.details && looksLikeCashNarrationSplit(row.details)) {
        // narration only — never post a payment from "Cash 97070" / "Vipul Cash 108162"
      }
    }
    if (!preview.totalsOk) {
      throw new BadRequestException(
        `Khata totals mismatch: parties=${preview.partyCount} AR=${preview.arMinor} AP=${preview.apMinor} expected ${KHATA_PARTY_COUNT}/${KHATA_AR_TOTAL_MINOR}/${KHATA_AP_TOTAL_MINOR}`,
      );
    }
    if (input.confirm === false) return { preview, status: "preview" };

    const existing = await this.prisma.khataImportBatch.findFirst({
      where: {
        factoryId: user.factoryId,
        partyCount: rows.length,
        arMinor: preview.arMinor,
        apMinor: preview.apMinor,
      },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return existing;

    const payload = input.base64 ?? Buffer.from(text).toString("base64");
    const stored = await this.files.upload(user, {
      fileName: input.fileName,
      contentType: input.contentType ?? (input.base64 ? "application/pdf" : "application/json"),
      base64: payload,
    });

    const cutover = parseFactoryDate(KHATA_CUTOVER);
    return this.prisma.$transaction(
      async (tx) => {
        await ensureChart(tx, user.factoryId);
        const batch = await tx.khataImportBatch.create({
          data: {
            factoryId: user.factoryId,
            fileName: input.fileName,
            fileId: stored.id,
            importedBy: user.id,
            partyCount: rows.length,
            arMinor: preview.arMinor,
            apMinor: preview.apMinor,
          },
        });
        for (const row of rows) {
          const get = Number(row.youllGet ?? 0);
          const give = Number(row.youllGive ?? 0);
          const kind = classifyPartyKind(row.name, give);
          const party = await ensureParty(tx, user.factoryId, row.name, kind);
          await tx.party.update({
            where: { id: party.id },
            data: { khataSourceName: row.name, kind },
          });
          const getMinor = rupeesToMinor(get);
          const giveMinor = rupeesToMinor(give);
          if (getMinor > 0) {
            await postVoucher(tx, {
              factoryId: user.factoryId,
              type: "opening",
              source: "khata_opening",
              clientOpId: shaClientOpId([user.factoryId, "khata-open", partyNameKey(row.name), KHATA_CUTOVER]),
              createdBy: user.id,
              operationalDate: cutover,
              partyId: party.id,
              fileId: stored.id,
              memo: `Khata opening You'll Get ${row.name}`,
              lines: [
                { ledgerCode: "AR", debit: getMinor, credit: 0, partyId: party.id },
                { ledgerCode: "OPENING_EQUITY", debit: 0, credit: getMinor },
              ],
            });
          }
          if (giveMinor > 0) {
            await postVoucher(tx, {
              factoryId: user.factoryId,
              type: "opening",
              source: "khata_opening",
              clientOpId: shaClientOpId([user.factoryId, "khata-open-ap", partyNameKey(row.name), KHATA_CUTOVER]),
              createdBy: user.id,
              operationalDate: cutover,
              partyId: party.id,
              fileId: stored.id,
              memo: `Khata opening You'll Give ${row.name}`,
              lines: [
                { ledgerCode: "OPENING_EQUITY", debit: giveMinor, credit: 0 },
                { ledgerCode: "AP", debit: 0, credit: giveMinor, partyId: party.id },
              ],
            });
          }
        }
        return batch;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  private async importStatements(
    user: AuthenticatedUser,
    input: { fileName: string; text?: string; base64?: string; contentType?: string },
    preview: KhataPreview,
  ) {
    const payload = input.base64 ?? Buffer.from(input.text ?? "").toString("base64");
    const stored = await this.files.upload(user, {
      fileName: input.fileName,
      contentType: input.contentType ?? "application/pdf",
      base64: payload,
    });
    const batch = await this.prisma.khataImportBatch.findFirst({
      where: { factoryId: user.factoryId },
      orderBy: { createdAt: "desc" },
    });
    if (!batch) throw new BadRequestException("Import the customer list before statement PDFs");
    for (const line of preview.statements) {
      const name = line.name;
      const party = name
        ? await this.prisma.party.findFirst({
            where: { factoryId: user.factoryId, nameKey: partyNameKey(name) },
          })
        : await this.prisma.party.findFirst({ where: { factoryId: user.factoryId } });
      if (!party) continue;
      await this.prisma.importedKhataLine.create({
        data: {
          batchId: batch.id,
          partyId: party.id,
          lineDate: line.date ? parseFactoryDate(normalizeDate(line.date)) : undefined,
          details: line.details,
          debitMinor: rupeesToMinor(line.debit),
          creditMinor: rupeesToMinor(line.credit),
          balanceAfter: line.balance == null ? undefined : rupeesToMinor(line.balance),
          sourceFileId: stored.id,
        },
      });
    }
    return { batchId: batch.id, lines: preview.statements.length, postedPayments: 0 };
  }
}

function normalizeDate(raw: string): string {
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return KHATA_CUTOVER;
  const d = m[1]!.padStart(2, "0");
  const mo = m[2]!.padStart(2, "0");
  let y = m[3]!;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo}-${d}`;
}
