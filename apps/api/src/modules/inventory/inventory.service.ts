import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InventoryKind, InventoryMovementType, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";

const DEFAULT_LOCATIONS: Array<{ code: string; name: string; locationType: string }> = [
  { code: "RAW_YARD", name: "Raw Yard", locationType: "RAW_YARD" },
  { code: "B21_QUEUE", name: "B-21 Queue", locationType: "B21_QUEUE" },
  { code: "B21_WIP", name: "B-21 WIP", locationType: "B21_WIP" },
  { code: "UNPOLISHED_STOCK", name: "Unpolished Stock", locationType: "UNPOLISHED_STOCK" },
  { code: "LPM_QUEUE", name: "LPM Queue", locationType: "LPM_QUEUE" },
  { code: "LPM_WIP", name: "LPM WIP", locationType: "LPM_WIP" },
  { code: "FINISHED_STOCK", name: "Finished Stock", locationType: "FINISHED_STOCK" },
  { code: "HOLD", name: "Hold", locationType: "HOLD" },
  { code: "PACKING", name: "Packing", locationType: "PACKING" },
  { code: "DELIVERED", name: "Delivered", locationType: "DELIVERED" },
];

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  locations(factoryId: string) {
    return this.prisma.inventoryLocation.findMany({
      where: { factoryId, active: true },
      orderBy: { code: "asc" },
    });
  }

  rawBlocks(factoryId: string) {
    return this.prisma.rawBlock.findMany({
      where: { factoryId },
      include: { supplier: true, location: true },
      orderBy: { createdAt: "desc" },
    });
  }

  slabs(factoryId: string) {
    return this.prisma.slab.findMany({
      where: { factoryId },
      include: { parentBlock: true, location: true },
      orderBy: { createdAt: "desc" },
    });
  }

  openingSnapshots(factoryId: string) {
    return this.prisma.openingInventorySnapshot.findMany({
      where: { factoryId },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });
  }

  movements(factoryId: string) {
    return this.prisma.inventoryMovement.findMany({
      where: { factoryId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  suppliers(factoryId: string) {
    return this.prisma.supplier.findMany({ where: { factoryId }, orderBy: { name: "asc" } });
  }

  async createSupplier(user: AuthenticatedUser, name: string, contactInfo?: string) {
    const supplier = await this.prisma.supplier.create({
      data: { factoryId: user.factoryId, name, contactInfo },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "supplier.create",
      entityType: "supplier",
      entityId: supplier.id,
    });
    return supplier;
  }

  async receiveBlock(
    user: AuthenticatedUser,
    input: {
      serialNumber: string;
      varietyName: string;
      supplierId?: string;
      quarry?: string;
      weightTons?: number;
      invoicedAmount?: number;
      actualAmountPaid?: number;
      qualityNote?: string;
      locationCode?: string;
      clientOpId: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.syncOperation.findUnique({
        where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId } },
      });
      if (existing) return existing.response;

      const location = await tx.inventoryLocation.findFirst({
        where: {
          factoryId: user.factoryId,
          code: input.locationCode ?? "RAW_YARD",
        },
      });
      if (!location) throw new BadRequestException("Location not found in this factory");
      if (input.supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, factoryId: user.factoryId },
        });
        if (!supplier) throw new BadRequestException("Supplier does not belong to this factory");
      }

      const block = await tx.rawBlock.create({
        data: {
          factoryId: user.factoryId,
          serialNumber: input.serialNumber.trim(),
          varietyName: input.varietyName,
          supplierId: input.supplierId,
          quarry: input.quarry,
          weightTons: input.weightTons,
          invoicedAmount: input.invoicedAmount,
          actualAmountPaid: input.actualAmountPaid,
          qualityNote: input.qualityNote,
          locationId: location.id,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          factoryId: user.factoryId,
          movementType: InventoryMovementType.GOODS_RECEIPT,
          rawBlockId: block.id,
          quantity: 1,
          idempotencyKey: input.clientOpId,
          actorId: user.id,
        },
      });
      const response = { block };
      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId: input.clientOpId,
          actorId: user.id,
          method: "POST",
          path: "/api/v1/inventory/raw-blocks",
          requestHash: input.serialNumber,
          statusCode: 201,
          response: response as Prisma.InputJsonValue,
        },
      });
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "inventory.receive_block",
          entityType: "raw_block",
          entityId: block.id,
          payload: { serialNumber: block.serialNumber },
        },
      });
      return response;
    });
  }

  async startOpeningCount(user: AuthenticatedUser) {
    const factory = await this.prisma.factory.findUniqueOrThrow({ where: { id: user.factoryId } });
    if (factory.operatingStatus === "LIVE") {
      throw new BadRequestException("Factory is already live");
    }
    const snapshot = await this.prisma.openingInventorySnapshot.create({
      data: { factoryId: user.factoryId, enteredById: user.id },
    });
    await this.prisma.factory.update({
      where: { id: user.factoryId },
      data: { operatingStatus: "OPENING_COUNT_IN_PROGRESS" },
    });
    return snapshot;
  }

  async addOpeningLine(
    user: AuthenticatedUser,
    snapshotId: string,
    kind: InventoryKind,
    payload: Prisma.InputJsonValue,
  ) {
    const snapshot = await this.prisma.openingInventorySnapshot.findFirst({
      where: { id: snapshotId, factoryId: user.factoryId },
    });
    if (!snapshot || snapshot.status !== "DRAFT") {
      throw new BadRequestException("Opening count is not in draft");
    }
    return this.prisma.openingInventoryLine.create({
      data: { snapshotId, kind, payload, enteredById: user.id },
    });
  }

  async submitOpening(user: AuthenticatedUser, snapshotId: string) {
    const snapshot = await this.prisma.openingInventorySnapshot.findFirst({
      where: { id: snapshotId, factoryId: user.factoryId },
    });
    if (!snapshot || snapshot.status !== "DRAFT") throw new BadRequestException("Cannot submit");
    await this.prisma.openingInventorySnapshot.update({
      where: { id: snapshotId },
      data: { status: "SUBMITTED" },
    });
    await this.prisma.factory.update({
      where: { id: user.factoryId },
      data: { operatingStatus: "OPENING_PENDING_APPROVAL" },
    });
    return { submitted: true };
  }

  async approveOpening(user: AuthenticatedUser, snapshotId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const snapshot = await tx.openingInventorySnapshot.findFirst({
          where: { id: snapshotId, factoryId: user.factoryId },
          include: { lines: true },
        });
        if (!snapshot || snapshot.status !== "SUBMITTED") {
          throw new BadRequestException("Opening count is not awaiting approval");
        }
        if (snapshot.lines.length === 0) {
          throw new BadRequestException("Opening count has no lines");
        }
        const enterers = new Set(snapshot.lines.map((line) => line.enteredById));
        if (enterers.has(user.id)) {
          throw new ForbiddenException("Anyone who entered opening lines cannot approve it");
        }
        const already = await tx.openingInventorySnapshot.findFirst({
          where: { factoryId: user.factoryId, status: "APPROVED" },
        });
        if (already) throw new ConflictException("An opening count is already approved");

        const rawYard = await tx.inventoryLocation.findFirst({
          where: { factoryId: user.factoryId, code: "RAW_YARD" },
        });
        const finished = await tx.inventoryLocation.findFirst({
          where: { factoryId: user.factoryId, code: "FINISHED_STOCK" },
        });
        const unpolished = await tx.inventoryLocation.findFirst({
          where: { factoryId: user.factoryId, code: "UNPOLISHED_STOCK" },
        });

        const blockLines = snapshot.lines.filter((line) => line.kind === "RAW_BLOCK");
        const slabLines = snapshot.lines.filter((line) => line.kind !== "RAW_BLOCK");

        if (blockLines.length > 0) {
          const blocks = await tx.rawBlock.createManyAndReturn({
            data: blockLines.map((line) => {
              const body = line.payload as Record<string, unknown>;
              return {
                factoryId: user.factoryId,
                serialNumber: String(body.serialNumber),
                varietyName: String(body.varietyName ?? "Unknown"),
                weightTons: payloadNumber(body.weightTons),
                invoicedAmount: payloadNumber(body.invoicedAmount),
                actualAmountPaid: payloadNumber(body.actualAmountPaid),
                locationId: rawYard?.id,
              };
            }),
          });
          const bySerial = new Map(blocks.map((block) => [block.serialNumber, block]));
          await tx.inventoryMovement.createMany({
            data: blockLines.map((line) => {
              const body = line.payload as Record<string, unknown>;
              const block = bySerial.get(String(body.serialNumber));
              if (!block) throw new BadRequestException("Opening block serial did not round-trip");
              return {
                factoryId: user.factoryId,
                movementType: InventoryMovementType.OPENING_RECEIPT,
                rawBlockId: block.id,
                quantity: 1,
                idempotencyKey: `opening:${line.id}`,
                actorId: user.id,
              };
            }),
          });
          for (const line of blockLines) {
            const body = line.payload as Record<string, unknown>;
            const block = bySerial.get(String(body.serialNumber));
            await tx.openingInventoryLine.update({
              where: { id: line.id },
              data: { rawBlockId: block?.id },
            });
          }
        }

        if (slabLines.length > 0) {
          const slabs = await tx.slab.createManyAndReturn({
            data: slabLines.map((line) => {
              const body = line.payload as Record<string, unknown>;
              const loc = line.kind === "POLISHED_SLAB" ? finished : unpolished;
              return {
                factoryId: user.factoryId,
                slabSerial: String(body.slabSerial),
                varietyName: String(body.varietyName ?? "Unknown"),
                thicknessMm: payloadNumber(body.thicknessMm) ?? 18,
                lengthFt: payloadNumber(body.lengthFt),
                widthFt: payloadNumber(body.widthFt),
                locationId: loc?.id,
              };
            }),
          });
          const bySerial = new Map(slabs.map((slab) => [slab.slabSerial, slab]));
          await tx.inventoryMovement.createMany({
            data: slabLines.map((line) => {
              const body = line.payload as Record<string, unknown>;
              const slab = bySerial.get(String(body.slabSerial));
              if (!slab) throw new BadRequestException("Opening slab serial did not round-trip");
              return {
                factoryId: user.factoryId,
                movementType: InventoryMovementType.OPENING_RECEIPT,
                slabId: slab.id,
                quantity: 1,
                idempotencyKey: `opening:${line.id}`,
                actorId: user.id,
              };
            }),
          });
          for (const line of slabLines) {
            const body = line.payload as Record<string, unknown>;
            const slab = bySerial.get(String(body.slabSerial));
            await tx.openingInventoryLine.update({
              where: { id: line.id },
              data: { slabId: slab?.id },
            });
          }
        }

        await tx.openingInventorySnapshot.update({
          where: { id: snapshotId },
          data: { status: "APPROVED", approvedById: user.id },
        });
        await tx.factory.update({
          where: { id: user.factoryId },
          data: { operatingStatus: "LIVE", goLiveDate: new Date() },
        });
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "inventory.opening_approved",
            entityType: "opening_inventory_snapshot",
            entityId: snapshotId,
            payload: { lines: snapshot.lines.length },
          },
        });
        return { approved: true, live: true };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  async reverseMovement(user: AuthenticatedUser, movementId: string, reason: string, clientOpId: string) {
    if (!reason?.trim()) throw new BadRequestException("Reason is required");
    if (!clientOpId) throw new BadRequestException("clientOpId is required");
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.syncOperation.findUnique({
        where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } },
      });
      if (existing) return existing.response;

      const movement = await tx.inventoryMovement.findFirst({
        where: { id: movementId, factoryId: user.factoryId },
      });
      if (!movement) throw new NotFoundException("Movement not found");
      if (movement.movementType === InventoryMovementType.REVERSAL) {
        throw new BadRequestException("Cannot reverse a reversal");
      }
      const already = await tx.inventoryMovement.findFirst({
        where: {
          factoryId: user.factoryId,
          movementType: InventoryMovementType.REVERSAL,
          notes: { startsWith: `reverses:${movement.id}` },
        },
      });
      if (already) throw new ConflictException("Movement already reversed");

      if (
        movement.movementType === InventoryMovementType.GOODS_RECEIPT ||
        movement.movementType === InventoryMovementType.OPENING_RECEIPT
      ) {
        if (!movement.rawBlockId) throw new BadRequestException("Receipt has no block to void");
        const block = await tx.rawBlock.findFirst({
          where: { id: movement.rawBlockId, factoryId: user.factoryId },
          include: { slabs: true, cuttingSessions: true },
        });
        if (!block) throw new NotFoundException("Block not found");
        if (block.slabs.length > 0 || block.cuttingSessions.length > 0) {
          throw new BadRequestException("Cannot reverse a block that has been cut");
        }
        if (block.currentStatus !== "in_stock") {
          throw new BadRequestException("Block is no longer in stock");
        }
        await tx.rawBlock.update({
          where: { id: block.id },
          data: { currentStatus: "voided", version: { increment: 1 } },
        });
      } else if (movement.movementType === InventoryMovementType.SALES_RESERVATION) {
        if (!movement.slabId) throw new BadRequestException("Reservation has no slab");
        const slab = await tx.slab.findFirst({
          where: { id: movement.slabId, factoryId: user.factoryId },
        });
        if (!slab) throw new NotFoundException("Slab not found");
        if (slab.salesStatus !== "reserved") {
          throw new BadRequestException("Slab is no longer reserved");
        }
        await tx.slab.update({
          where: { id: slab.id },
          data: { salesStatus: "in_stock", version: { increment: 1 } },
        });
      } else if (movement.movementType === InventoryMovementType.DELIVERY) {
        if (!movement.slabId) throw new BadRequestException("Delivery has no slab");
        const slab = await tx.slab.findFirst({
          where: { id: movement.slabId, factoryId: user.factoryId },
        });
        if (!slab) throw new NotFoundException("Slab not found");
        if (slab.salesStatus !== "sold") {
          throw new BadRequestException("Slab is no longer marked sold");
        }
        await tx.slab.update({
          where: { id: slab.id },
          data: { salesStatus: "in_stock", version: { increment: 1 } },
        });
      } else {
        throw new BadRequestException(`No reversal path for ${movement.movementType}`);
      }

      const reversal = await tx.inventoryMovement.create({
        data: {
          factoryId: user.factoryId,
          movementType: InventoryMovementType.REVERSAL,
          rawBlockId: movement.rawBlockId,
          slabId: movement.slabId,
          quantity: movement.quantity,
          idempotencyKey: clientOpId,
          actorId: user.id,
          notes: `reverses:${movement.id} ${reason.trim()}`,
        },
      });
      const response = { reversed: true, movementId: reversal.id, originalId: movement.id };
      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId,
          actorId: user.id,
          method: "POST",
          path: `/api/v1/inventory/movements/${movement.id}/reverse`,
          requestHash: clientOpId,
          statusCode: 200,
          response: response as Prisma.InputJsonValue,
        },
      });
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "inventory.movement_reversed",
          entityType: "inventory_movement",
          entityId: reversal.id,
          payload: { originalId: movement.id, reason: reason.trim(), type: movement.movementType },
        },
      });
      return response;
    });
  }

  async ensureDefaultLocations(factoryId: string) {
    for (const loc of DEFAULT_LOCATIONS) {
      await this.prisma.inventoryLocation.upsert({
        where: { factoryId_code: { factoryId, code: loc.code } },
        update: {},
        create: {
          factoryId,
          code: loc.code,
          name: loc.name,
          locationType: loc.locationType as never,
        },
      });
    }
  }
}

function payloadNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
