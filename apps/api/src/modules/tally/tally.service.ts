import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";

export function parseDaybookXml(xml: string): { vouchers: number; ledgers: string[] } {
  const voucherMatches = xml.match(/<VOUCHER[\s>]/gi) ?? [];
  const ledgers = [...xml.matchAll(/<LEDGERNAME>([^<]+)<\/LEDGERNAME>/gi)].map((m) => m[1] ?? "");
  return { vouchers: voucherMatches.length, ledgers: [...new Set(ledgers)] };
}

@Injectable()
export class TallyService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async importDaybook(user: AuthenticatedUser, fileName: string, xml: string) {
    const parsed = parseDaybookXml(xml);
    return this.prisma.tallyImportBatch.create({
      data: {
        factoryId: user.factoryId,
        kind: "daybook",
        fileName,
        importedBy: user.id,
        summary: parsed,
      },
    });
  }
}
