import {
  BadRequestException,
  NotFoundException,
  Inject,
  Injectable,
} from "@nestjs/common";
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
    input: {
      fileName: string;
      contentType: string;
      base64: string;
      entityType?: string;
      entityId?: string;
    },
  ) {
    let prefix = user.factoryId;
    if (input.entityType || input.entityId) {
      const exists =
        input.entityType === "block"
          ? await this.prisma.rawBlock.findFirst({
              where: { id: input.entityId, factoryId: user.factoryId },
            })
          : input.entityType === "order"
            ? await this.prisma.salesOrder.findFirst({
                where: { id: input.entityId, factoryId: user.factoryId },
              })
            : null;
      if (!exists)
        throw new BadRequestException("Attachment target not in this factory");
      prefix += `/${input.entityType}/${input.entityId}`;
    }
    if (
      input.entityType &&
      (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(input.contentType) ||
        Buffer.byteLength(input.base64, "base64") > 4 * 1024 * 1024)
    )
      throw new BadRequestException("Use an image or PDF under 4 MB");
    const key = `${prefix}/${Date.now()}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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

  async read(factoryId: string, id: string) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, factoryId },
    });
    if (!file) throw new NotFoundException("Attachment not found");
    const object = await this.storage.get(file.key);
    return {
      contentType: file.contentType,
      base64: object.bytes.toString("base64"),
    };
  }
  list(factoryId: string, entityType?: string, entityId?: string) {
    return this.prisma.storedFile.findMany({
      where: {
        factoryId,
        ...(entityType && entityId
          ? { key: { startsWith: `${factoryId}/${entityType}/${entityId}/` } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
