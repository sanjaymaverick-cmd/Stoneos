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
      data: { snapshotId, kind, payload },
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
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.openingInventorySnapshot.findFirst({
        where: { id: snapshotId, factoryId: user.factoryId },
        include: { lines: true },
      });
      if (!snapshot || snapshot.status !== "SUBMITTED") {
        throw new BadRequestException("Opening count is not awaiting approval");
      }
      if (snapshot.enteredById === user.id) {
        throw new ForbiddenException("The person who entered the count cannot approve it");
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

      for (const line of snapshot.lines) {
        const body = line.payload as Record<string, string>;
        if (line.kind === "RAW_BLOCK") {
          const block = await tx.rawBlock.create({
            data: {
              factoryId: user.factoryId,
              serialNumber: String(body.serialNumber),
              varietyName: String(body.varietyName ?? "Unknown"),
              locationId: rawYard?.id,
            },
          });
          await tx.openingInventoryLine.update({
            where: { id: line.id },
            data: { rawBlockId: block.id },
          });
          await tx.inventoryMovement.create({
            data: {
              factoryId: user.factoryId,
              movementType: "OPENING_RECEIPT",
              rawBlockId: block.id,
              quantity: 1,
              idempotencyKey: `opening:${line.id}`,
              actorId: user.id,
            },
          });
        } else {
          const loc = line.kind === "POLISHED_SLAB" ? finished : unpolished;
          const slab = await tx.slab.create({
            data: {
              factoryId: user.factoryId,
              slabSerial: String(body.slabSerial),
              varietyName: String(body.varietyName ?? "Unknown"),
              locationId: loc?.id,
            },
          });
          await tx.openingInventoryLine.update({
            where: { id: line.id },
            data: { slabId: slab.id },
          });
          await tx.inventoryMovement.create({
            data: {
              factoryId: user.factoryId,
              movementType: "OPENING_RECEIPT",
              slabId: slab.id,
              quantity: 1,
              idempotencyKey: `opening:${line.id}`,
              actorId: user.id,
            },
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
