import { Inject, Injectable } from "@nestjs/common";
import { createObjectStorage } from "@stoneos/storage";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";

@Injectable()
export class FilesService {
  private storage = createObjectStorage();

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  async upload(
    user: AuthenticatedUser,
    input: { fileName: string; contentType: string; base64: string },
  ) {
    const key = `${user.factoryId}/${Date.now()}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await this.storage.put({
      key,
      contentType: input.contentType,
      bytes: Buffer.from(input.base64, "base64"),
    });
    const row = await this.prisma.storedFile.create({
      data: {
        factoryId: user.factoryId,
        key,
        contentType: input.contentType,
        uploadedBy: user.id,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "file.upload",
      entityType: "stored_file",
      entityId: row.id,
      payload: { key, contentType: input.contentType },
    });
    return row;
  }

  list(factoryId: string) {
    return this.prisma.storedFile.findMany({
      where: { factoryId },
      orderBy: { createdAt: "desc" },
    });
  }
}
