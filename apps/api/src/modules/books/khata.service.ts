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

export type KhataPartyRow = {
  name: string;
  youllGet?: number;
  youllGive?: number;
  details?: string;
};

export function classifyPartyKind(name: string, youllGive: number): "customer" | "supplier" | "job" {
  if (/\bjob\b/i.test(name) || /charging job/i.test(name)) return "job";
  if (youllGive > 0) return "supplier";
  return "customer";
}

export function parseKhataList(raw: string): KhataPartyRow[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as { parties?: KhataPartyRow[] } | KhataPartyRow[];
    return Array.isArray(parsed) ? parsed : parsed.parties ?? [];
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const out: KhataPartyRow[] = [];
  for (const line of lines.slice(1)) {
    if (/total|grand total|opening balance/i.test(line)) continue;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    out.push({
      name: cols[0] ?? "",
      youllGet: Number(String(cols[1] ?? "0").replace(/,/g, "")) || 0,
      youllGive: Number(String(cols[2] ?? "0").replace(/,/g, "")) || 0,
    });
  }
  return out.filter((r) => r.name);
}

export function looksLikeCashNarrationSplit(details: string): boolean {
  return /cash\s+\d/i.test(details);
}

@Injectable()
export class KhataService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FilesService) private files: FilesService,
  ) {}

  async importList(
    user: AuthenticatedUser,
    input: { fileName: string; body: string; contentType?: string },
  ) {
    const rows = parseKhataList(input.body);
    if (rows.length === 0) throw new BadRequestException("No parties in khata list");
    for (const row of rows) {
      if (row.details && looksLikeCashNarrationSplit(row.details)) {
        // narration only — never post a payment from "Cash 97070" / "Vipul Cash 108162"
      }
    }

    let arMinor = 0;
    let apMinor = 0;
    for (const row of rows) {
      arMinor += rupeesToMinor(Number(row.youllGet ?? 0));
      apMinor += rupeesToMinor(Number(row.youllGive ?? 0));
    }
    if (rows.length !== KHATA_PARTY_COUNT || arMinor !== KHATA_AR_TOTAL_MINOR || apMinor !== KHATA_AP_TOTAL_MINOR) {
      throw new BadRequestException(
        `Khata totals mismatch: parties=${rows.length} AR=${arMinor} AP=${apMinor} expected ${KHATA_PARTY_COUNT}/${KHATA_AR_TOTAL_MINOR}/${KHATA_AP_TOTAL_MINOR}`,
      );
    }

    const existing = await this.prisma.khataImportBatch.findFirst({
      where: { factoryId: user.factoryId, partyCount: rows.length, arMinor, apMinor },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return existing;

    const stored = await this.files.upload(user, {
      fileName: input.fileName,
      contentType: input.contentType ?? "application/json",
      base64: Buffer.from(input.body).toString("base64"),
    });

    const cutover = parseFactoryDate(KHATA_CUTOVER);
    return this.prisma.$transaction(
      async (tx) => {
        await ensureChart(tx, user.factoryId);
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
        return tx.khataImportBatch.create({
          data: {
            factoryId: user.factoryId,
            fileName: input.fileName,
            fileId: stored.id,
            importedBy: user.id,
            partyCount: rows.length,
            arMinor,
            apMinor,
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }
}
