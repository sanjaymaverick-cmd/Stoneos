import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { damagedCostAtRawBlock, damagedSlabCount, slabSerial } from "@stoneos/domain";
import { operationalDateFor } from "@stoneos/domain";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";

@Injectable()
export class ProductionService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  machines(factoryId: string) {
    return this.prisma.machine.findMany({ where: { factoryId, active: true } });
  }

  cuttingSessions(factoryId: string) {
    return this.prisma.cuttingSession.findMany({
      where: { factoryId },
      include: { rawBlock: true, machine: true, dayLogs: true },
      orderBy: { startedAt: "desc" },
    });
  }

  polishingSessions(factoryId: string) {
    return this.prisma.polishingSession.findMany({
      where: { factoryId },
      include: { slabs: true, machine: true },
      orderBy: { operationalDate: "desc" },
    });
  }

  async startCutting(
    user: AuthenticatedUser,
    input: { rawBlockId: string; machineId: string; expectedSlabCount?: number },
  ) {
    const block = await this.prisma.rawBlock.findFirst({
      where: { id: input.rawBlockId, factoryId: user.factoryId },
    });
    const machine = await this.prisma.machine.findFirst({
      where: { id: input.machineId, factoryId: user.factoryId, machineType: "CUTTING" },
    });
    if (!block || !machine) throw new NotFoundException("Block or machine not in this factory");
    const active = await this.prisma.cuttingSession.findFirst({
      where: { rawBlockId: block.id, status: "IN_PROGRESS" },
    });
    if (active) throw new BadRequestException("Block already has an active cutting session");

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cuttingSession.create({
        data: {
          factoryId: user.factoryId,
          rawBlockId: block.id,
          machineId: machine.id,
          startedAt: new Date(),
          expectedSlabCount: input.expectedSlabCount,
        },
      });
      await tx.rawBlock.update({
        where: { id: block.id },
        data: { currentStatus: "under_cutting", version: { increment: 1 } },
      });
      return created;
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "production.cutting_start",
      entityType: "cutting_session",
      entityId: session.id,
    });
    return session;
  }

  async logCuttingDay(
    user: AuthenticatedUser,
    sessionId: string,
    input: {
      runtimeHours?: number;
      downtimeMinutes?: number;
      downtimeReason?: string;
      slabsProducedCount?: number;
      notes?: string;
      baseVersion?: number;
    },
  ) {
    const session = await this.prisma.cuttingSession.findFirst({
      where: { id: sessionId, factoryId: user.factoryId },
    });
    if (!session) throw new NotFoundException("Session not found");
    const operationalDate = operationalDateFor(new Date());
    if (input.baseVersion != null) {
      const existing = await this.prisma.cuttingDayLog.findUnique({
        where: {
          cuttingSessionId_operationalDate: { cuttingSessionId: sessionId, operationalDate },
        },
      });
      if (existing && existing.version !== input.baseVersion) {
        throw new ConflictException({
          code: "VERSION_CONFLICT",
          serverVersion: existing.version,
          server: existing,
        });
      }
    }
    return this.prisma.cuttingDayLog.upsert({
      where: {
        cuttingSessionId_operationalDate: { cuttingSessionId: sessionId, operationalDate },
      },
      create: {
        cuttingSessionId: sessionId,
        operationalDate,
        runtimeHours: input.runtimeHours,
        downtimeMinutes: input.downtimeMinutes,
        downtimeReason: input.downtimeReason,
        slabsProducedCount: input.slabsProducedCount,
        operatorId: user.id,
        notes: input.notes,
      },
      update: {
        runtimeHours: input.runtimeHours,
        downtimeMinutes: input.downtimeMinutes,
        downtimeReason: input.downtimeReason,
        slabsProducedCount: input.slabsProducedCount,
        notes: input.notes,
        version: { increment: 1 },
      },
    });
  }

  async completeCutting(
    user: AuthenticatedUser,
    sessionId: string,
    input: {
      totalSlabsCut: number;
      finalGoodSlabCount: number;
      lengthFt?: number;
      widthFt?: number;
      thicknessMm?: number;
      finish?: string;
    },
  ) {
    const session = await this.prisma.cuttingSession.findFirst({
      where: { id: sessionId, factoryId: user.factoryId },
      include: { rawBlock: true },
    });
    if (!session || session.status !== "IN_PROGRESS") {
      throw new BadRequestException("Session is not in progress");
    }
    const damaged = damagedSlabCount(input.totalSlabsCut, input.finalGoodSlabCount);
    const rawCost = Number(session.rawBlock.actualAmountPaid ?? session.rawBlock.invoicedAmount ?? 0);
    const damagedCost = damagedCostAtRawBlock(input.totalSlabsCut, damaged, rawCost);
    const unpolished = await this.prisma.inventoryLocation.findFirst({
      where: { factoryId: user.factoryId, code: "UNPOLISHED_STOCK" },
    });

    return this.prisma.$transaction(async (tx) => {
      const slabs = [];
      for (let seq = 1; seq <= input.finalGoodSlabCount; seq += 1) {
        const serial = slabSerial(session.rawBlock.serialNumber, input.totalSlabsCut, seq);
        const slab = await tx.slab.create({
          data: {
            factoryId: user.factoryId,
            parentBlockId: session.rawBlockId,
            cuttingSessionId: session.id,
            slabSerial: serial,
            varietyName: session.rawBlock.varietyName,
            thicknessMm: input.thicknessMm ?? 18,
            lengthFt: input.lengthFt,
            widthFt: input.widthFt,
            finish: input.finish,
            locationId: unpolished?.id,
          },
        });
        slabs.push(slab);
        await tx.inventoryMovement.create({
          data: {
            factoryId: user.factoryId,
            movementType: "PRODUCTION_COMPLETION",
            slabId: slab.id,
            quantity: 1,
            idempotencyKey: `cut:${session.id}:${seq}`,
            actorId: user.id,
          },
        });
      }
      const updated = await tx.cuttingSession.update({
        where: { id: session.id },
        data: {
          status: "COMPLETED",
          endedAt: new Date(),
          totalSlabsCut: input.totalSlabsCut,
          finalGoodSlabCount: input.finalGoodSlabCount,
          damagedSlabCount: damaged,
          damagedCostAmount: damagedCost,
        },
      });
      await tx.rawBlock.update({
        where: { id: session.rawBlockId },
        data: { currentStatus: "consumed", version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "production.cutting_complete",
          entityType: "cutting_session",
          entityId: session.id,
          payload: { good: input.finalGoodSlabCount, damaged, damagedCost },
        },
      });
      return { session: updated, slabs, damaged, damagedCost };
    });
  }

  async startPolishing(
    user: AuthenticatedUser,
    input: { machineId: string; processType: "GRINDING" | "RESIN" | "POLISHING"; slabIds: string[]; finishType?: string },
  ) {
    const machine = await this.prisma.machine.findFirst({
      where: { id: input.machineId, factoryId: user.factoryId, machineType: "POLISHING" },
    });
    if (!machine) throw new NotFoundException("Polishing machine not found");
    const slabs = await this.prisma.slab.findMany({
      where: { factoryId: user.factoryId, id: { in: input.slabIds } },
    });
    if (slabs.length !== input.slabIds.length) {
      throw new BadRequestException("One or more slabs are not in this factory");
    }
    return this.prisma.polishingSession.create({
      data: {
        factoryId: user.factoryId,
        machineId: machine.id,
        operationalDate: operationalDateFor(new Date()),
        processType: input.processType,
        finishType: input.finishType,
        slabs: { create: slabs.map((s) => ({ slabId: s.id })) },
      },
      include: { slabs: true },
    });
  }

  async completePolishing(user: AuthenticatedUser, sessionId: string) {
    const session = await this.prisma.polishingSession.findFirst({
      where: { id: sessionId, factoryId: user.factoryId },
      include: { slabs: { include: { slab: true } } },
    });
    if (!session) throw new NotFoundException("Session not found");
    if (session.status !== "IN_PROGRESS") {
      throw new BadRequestException("Session is not in progress");
    }
    const blocked = session.slabs.filter((link) =>
      ["sold", "reserved", "voided"].includes(link.slab.salesStatus),
    );
    if (blocked.length > 0) {
      throw new BadRequestException("Cannot complete process on sold, reserved, or voided slabs");
    }
    const sellable = session.processType === "POLISHING";
    const finished = sellable
      ? await this.prisma.inventoryLocation.findFirst({
          where: { factoryId: user.factoryId, code: "FINISHED_STOCK" },
        })
      : null;
    await this.prisma.$transaction(async (tx) => {
      for (const link of session.slabs) {
        if (sellable) {
          await tx.slab.update({
            where: { id: link.slabId },
            data: {
              salesStatus: "in_stock",
              finish: session.finishType ?? undefined,
              locationId: finished?.id,
              version: { increment: 1 },
            },
          });
          await tx.inventoryMovement.create({
            data: {
              factoryId: user.factoryId,
              movementType: "POLISHING_COMPLETION",
              slabId: link.slabId,
              quantity: 1,
              idempotencyKey: `polish:${session.id}:${link.slabId}`,
              actorId: user.id,
            },
          });
        } else {
          await tx.slab.update({
            where: { id: link.slabId },
            data: {
              finish: session.finishType ?? undefined,
              version: { increment: 1 },
            },
          });
        }
      }
      await tx.polishingSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED" },
      });
    });
    return { completed: true, processType: session.processType, sellable };
  }

  async derivedDpr(factoryId: string, from: Date, to: Date) {
    const fromDay = operationalDateFor(from);
    const toDay = operationalDateFor(to);
    const cutting = await this.prisma.cuttingDayLog.findMany({
      where: {
        session: { factoryId },
        operationalDate: { gte: fromDay, lte: toDay },
      },
    });
    const polishing = await this.prisma.polishingSession.findMany({
      where: { factoryId, operationalDate: { gte: fromDay, lte: toDay }, status: "COMPLETED" },
      include: { slabs: true },
    });
    const produced = await this.prisma.slab.findMany({
      where: {
        factoryId,
        cuttingSessionId: { not: null },
        createdAt: {
          gte: new Date(fromDay.getTime() - 12 * 3600 * 1000),
          lte: new Date(toDay.getTime() + 36 * 3600 * 1000),
        },
      },
      select: { createdAt: true },
    });
    const slabsCut = produced.filter((row) => {
      const day = operationalDateFor(row.createdAt).getTime();
      return day >= fromDay.getTime() && day <= toDay.getTime();
    }).length;
    return {
      from: fromDay,
      to: toDay,
      slabsCut,
      runtimeHours: cutting.reduce((sum, row) => sum + Number(row.runtimeHours ?? 0), 0),
      downtimeMinutes: cutting.reduce((sum, row) => sum + (row.downtimeMinutes ?? 0), 0),
      slabsPolished: polishing.reduce((sum, row) => sum + row.slabs.length, 0),
    };
  }
}
