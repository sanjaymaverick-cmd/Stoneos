import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async record(input: {
    factoryId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    payload?: unknown;
  }) {
    await this.prisma.auditEvent.create({
      data: {
        factoryId: input.factoryId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
