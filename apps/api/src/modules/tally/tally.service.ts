import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { parseDaybookXml } from "./tally-parse";

export { parseDaybookXml } from "./tally-parse";

@Injectable()
export class TallyService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  async importDaybook(user: AuthenticatedUser, fileName: string, xml: string) {
    const parsed = parseDaybookXml(xml);
    const batch = await this.prisma.tallyImportBatch.create({
      data: {
        factoryId: user.factoryId,
        kind: "daybook",
        fileName,
        importedBy: user.id,
        summary: parsed as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "tally.daybook_import",
      entityType: "tally_import_batch",
      entityId: batch.id,
      payload: { fileName, vouchers: parsed.vouchers, totalAbsAmount: parsed.totalAbsAmount },
    });
    return batch;
  }

  batches(factoryId: string) {
    return this.prisma.tallyImportBatch.findMany({
      where: { factoryId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
}
