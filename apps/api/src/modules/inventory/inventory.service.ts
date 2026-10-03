import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InventoryKind, InventoryMovementType, Prisma } from "@prisma/client";
import { MAX_BLOCK_TONS } from "@stoneos/contracts";
import { costPerSlab } from "@stoneos/domain";
import { PrismaService } from "../../common/prisma.service";
import { parseOccurredAt } from "../../common/occurred-at";
import { AuditService } from "../../common/audit.service";
import { BooksService } from "../books/books.service";
import {
  GST_DEFAULTS,
  gstOnTaxable,
  minorToRupees,
  normaliseStateCode,
  rupeesToMinor,
  stateCodeFromGstin,
} from "../books/money";
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
    @Inject(BooksService) private books: BooksService,
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

  async createSupplier(
    user: AuthenticatedUser,
    name: string,
    contactInfo?: string,
    gst?: { stateCode?: string | null; gstin?: string | null; billingAddress?: string | null; shippingAddress?: string | null },
  ) {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException("A supplier needs a name");
    const gstin = supplierGstin(gst?.gstin);
    const claimed = normaliseStateCode(gst?.stateCode);
    const fromGstin = gstin ? stateCodeFromGstin(gstin) : null;
    if (claimed && fromGstin && claimed !== fromGstin) throw new BadRequestException("State code contradicts supplier GSTIN");
    const stateCode = fromGstin ?? claimed;
    const supplier = await this.prisma.supplier.create({
      data: { factoryId: user.factoryId, name: trimmed, contactInfo: contactInfo?.trim() || null, stateCode, gstin, billingAddress: gst?.billingAddress?.trim() || null, shippingAddress: gst?.shippingAddress?.trim() || null },
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

  async updateSupplier(user: AuthenticatedUser, id: string, input: {name?: string;contactInfo?: string | null;gstin?: string | null;stateCode?: string | null;billingAddress?: string | null;shippingAddress?: string | null}) {
    const existing = await this.prisma.supplier.findFirst({where:{id,factoryId:user.factoryId}});
    if (!existing) throw new NotFoundException("Supplier not found");
    const data: Prisma.SupplierUpdateInput = {version:{increment:1}};
    if(input.name !== undefined){if(!input.name.trim())throw new BadRequestException("A supplier needs a name");data.name=input.name.trim();}
    for(const field of ["contactInfo","billingAddress","shippingAddress"] as const) if(input[field] !== undefined)data[field]=input[field]?.trim() || null;
    if(input.gstin !== undefined || input.stateCode !== undefined){
      const gstin=input.gstin === undefined ? existing.gstin : supplierGstin(input.gstin);
      const claimed=normaliseStateCode(input.stateCode === undefined ? existing.stateCode : input.stateCode);
      const fromGstin=gstin ? stateCodeFromGstin(gstin) : null;
      if(claimed && fromGstin && claimed !== fromGstin)throw new BadRequestException("State code contradicts supplier GSTIN");
      data.gstin=gstin;data.stateCode=fromGstin ?? claimed;
    }
    const updated=await this.prisma.supplier.update({where:{id:existing.id},data});
    await this.audit.record({factoryId:user.factoryId,actorId:user.id,action:"supplier.update",entityType:"supplier",entityId:existing.id});
    return updated;
  }

  /**
   * Put a cash amount on a block that was received before the yard screen asked for one.
   *
   * Every block taken in before this field reached the form carries nothing in the
   * cash leg, so its cost basis is the billed amount alone and the cost of each slab
   * off it is understated. This is the correction path: the owner enters what was
   * actually paid, with a reason, and the difference is posted.
   *
   * Only the cash leg. Changing the billed amount would mean amending a vendor's tax
   * invoice and the input credit claimed against it, which is not something to do
   * from a yard screen.
   *
   * What this does NOT do is re-value history. Breakage already written off was
   * valued at the cost basis of the day, and those ledger entries stand; only
   * write-offs made from now on use the corrected figure. Restating a posted expense
   * would change months that may already be filed.
   */
  async correctPurchaseCash(
    user: AuthenticatedUser,
    input: {
      blockSerial: string;
      purchaseCashAmount: number;
      reason: string;
      clientOpId: string;
    },
  ) {
    if (!Number.isFinite(input.purchaseCashAmount) || input.purchaseCashAmount < 0) {
      throw new BadRequestException("Cash amount cannot be negative");
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException("Say why the cash amount is being changed");
    }
    if (!input.clientOpId) throw new BadRequestException("clientOpId is required");

    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.syncOperation.findUnique({
        where: {
          factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId },
        },
      });
      if (replay) return replay.response;

      const block = await tx.rawBlock.findFirst({
        where: { factoryId: user.factoryId, serialNumber: input.blockSerial.trim() },
      });
      if (!block) throw new NotFoundException(`No block ${input.blockSerial} in this factory`);

      const before = Number(block.purchaseCashAmount ?? 0);
      const after = input.purchaseCashAmount;
      const deltaMinor = rupeesToMinor(after) - rupeesToMinor(before);

      await tx.rawBlock.update({
        where: { id: block.id },
        data: { purchaseCashAmount: after, version: { increment: 1 } },
      });

      // Nothing moved, so nothing is posted. Still audited: an attempt to change a
      // cost basis is worth a record even when it changed nothing.
      if (deltaMinor !== 0) {
        await this.books.postCashPurchaseCorrection(tx, user, {
          rawBlockId: block.id,
          deltaMinor,
          clientOpId: `purchase-cash-fix:${input.clientOpId}`,
          memo: `Block ${block.serialNumber} — cash corrected: ${reason}`,
          purchaseDate: block.purchaseDate ?? block.createdAt,
        });
      }

      const taxable = Number(block.purchaseTaxable ?? 0);
      const response = {
        blockId: block.id,
        blockSerial: block.serialNumber,
        previousCashAmount: before,
        purchaseCashAmount: after,
        purchaseTaxable: taxable,
        costBasis: taxable + after,
        goodSlabCount: block.goodSlabCount,
        costPerSlab: costPerSlab({
          purchaseTaxable: taxable,
          purchaseCashAmount: after,
          goodSlabCount: block.goodSlabCount,
        }),
      };

      await tx.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId: input.clientOpId,
          actorId: user.id,
          method: "POST",
          path: "/api/v1/inventory/raw-blocks/correct-cash",
          requestHash: input.clientOpId,
          statusCode: 200,
          response: response as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.auditEvent.create({
        data: {
          factoryId: user.factoryId,
          actorId: user.id,
          action: "inventory.purchase_cash_corrected",
          entityType: "raw_block",
          entityId: block.id,
          payload: {
            blockSerial: block.serialNumber,
            previousCashAmount: before,
            purchaseCashAmount: after,
            reason,
          },
        },
      });
      return response;
    });
  }

  async receiveBlock(
    user: AuthenticatedUser,
    input: {
      serialNumber: string;
      varietyName: string;
      supplierId?: string;
      quarry?: string;
      weightTons?: number;
      /** Value before tax. Rough blocks are quoted ex-GST like everything else. */
      purchaseTaxable?: number;
      /** Statutory slab. Defaults to 5% for rough blocks (HSN 2516). */
      gstRatePct?: number;
      /**
       * Paid in cash outside the bill. Cost of stone like the taxable leg, but it
       * carries no GST and so no input credit — an unregistered quarry cannot charge
       * tax. It sits beside purchaseTaxable in the cost basis, never inside it.
       */
      purchaseCashAmount?: number;
      supplierInvoiceNo?: string;
      invoicedAmount?: number;
      actualAmountPaid?: number;
      purchasePaymentMethod?: string;
      qualityNote?: string;
      locationCode?: string;
      clientOpId: string;
      /** When the truck was unloaded, if it is synced later. */
      occurredAt?: string;
    },
  ) {
    const receivedAt = parseOccurredAt(input.occurredAt);
    assertBlockWeight(input.weightTons);
    for (const [field, value] of [
      ["purchaseTaxable", input.purchaseTaxable],
      ["purchaseCashAmount", input.purchaseCashAmount],
      ["invoicedAmount", input.invoicedAmount],
      ["actualAmountPaid", input.actualAmountPaid],
    ] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        throw new BadRequestException(`${field} cannot be negative`);
      }
    }
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
      let supplier: { id: string; name: string; stateCode: string | null; gstin: string | null } | null = null;
      if (input.supplierId) {
        supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, factoryId: user.factoryId },
        });
        if (!supplier) throw new BadRequestException("Supplier does not belong to this factory");
      }

      // Rough blocks are 5% (HSN 2516), not the 18% a finished slab carries. The rate is
      // chosen per receipt because a yard buys more than stone.
      const taxable = input.purchaseTaxable ?? input.invoicedAmount ?? 0;
      const cash = input.purchaseCashAmount ?? 0;
      const profile = await tx.gstProfile.findUnique({ where: { factoryId: user.factoryId } });
      const ourState = profile ? (stateCodeFromGstin(profile.gstin) ?? profile.stateCode) : null;
      const vendorState =
        supplier?.stateCode ?? (supplier?.gstin ? stateCodeFromGstin(supplier.gstin) : null);
      const gst = gstOnTaxable(rupeesToMinor(taxable), {
        // On a purchase we are the recipient: the credit heads follow whether the vendor
        // is in our state, so our own state is the place of supply.
        supplierStateCode: vendorState ?? ourState,
        placeOfSupplyStateCode: ourState,
        ratePct: input.gstRatePct,
        defaultRatePct: GST_DEFAULTS.rawBlock,
        registered: Boolean(profile && taxable > 0),
      });

      const block = await tx.rawBlock.create({
        data: {
          factoryId: user.factoryId,
          serialNumber: input.serialNumber.trim(),
          varietyName: input.varietyName,
          supplierId: input.supplierId,
          quarry: input.quarry,
          weightTons: input.weightTons,
          purchaseTaxable: taxable || undefined,
          purchaseCashAmount: cash,
          purchaseCgst: minorToRupees(gst.cgstMinor),
          purchaseSgst: minorToRupees(gst.sgstMinor),
          purchaseIgst: minorToRupees(gst.igstMinor),
          purchaseGstRatePct: gst.ratePct,
          supplierInvoiceNo: input.supplierInvoiceNo?.trim() || undefined,
          supplierGstin: supplier?.gstin ?? undefined,
          placeOfSupply: normaliseStateCode(ourState) ?? undefined,
          // The vendor is owed the whole bill; the block is valued at the taxable amount.
          invoicedAmount: input.invoicedAmount ?? (taxable ? minorToRupees(gst.totalMinor) : undefined),
          actualAmountPaid: input.actualAmountPaid,
          purchasePaymentMethod: input.purchasePaymentMethod?.trim() || null,
          qualityNote: input.qualityNote,
          locationId: location.id,
          purchaseDate: receivedAt,
          createdAt: receivedAt,
        },
      });
      if (cash > 0) {
        await this.books.postCashPurchase(tx, user, {
          rawBlockId: block.id,
          amountMinor: rupeesToMinor(cash),
          clientOpId: `purchase-cash:${input.clientOpId}`,
          memo: `Block ${block.serialNumber} — cash, no bill`,
          purchaseDate: receivedAt,
        });
      }
      if (taxable > 0) {
        await this.books.postPurchase(tx, user, {
          rawBlockId: block.id,
          supplierName: supplier?.name ?? "Unknown supplier",
          gst,
          clientOpId: `purchase:${input.clientOpId}`,
          memo: `Block ${block.serialNumber}${input.supplierInvoiceNo ? ` / ${input.supplierInvoiceNo}` : ""}`,
        });
      }
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
    if (kind === "RAW_BLOCK") {
      // Counted stock is weighed stock: the same rule as a block received today.
      const tons = (payload as Record<string, unknown> | null)?.weightTons;
      assertBlockWeight(tons == null || tons === "" ? undefined : Number(tons));
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
      } else if (
        movement.movementType === InventoryMovementType.DELIVERY ||
        movement.movementType === InventoryMovementType.DISPATCH
      ) {
        if (!movement.slabId) throw new BadRequestException("Dispatch has no slab");
        const slab = await tx.slab.findFirst({
          where: { id: movement.slabId, factoryId: user.factoryId },
        });
        if (!slab) throw new NotFoundException("Slab not found");
        if (slab.salesStatus !== "sold" && slab.salesStatus !== "dispatched") {
          throw new BadRequestException("Slab is no longer marked dispatched");
        }
        const packing = await tx.inventoryLocation.findFirst({
          where: { factoryId: user.factoryId, code: "PACKING" },
        });
        await tx.slab.update({
          where: { id: slab.id },
          data: { salesStatus: "in_stock", locationId: packing?.id ?? slab.locationId, version: { increment: 1 } },
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

/**
 * A received block has a real weight. Zero or negative tons broke recovery (sqft per
 * ton) and the stock value; past MAX_BLOCK_TONS it is kilograms typed as tons.
 */
export function assertBlockWeight(weightTons: unknown): asserts weightTons is number {
  if (typeof weightTons !== "number" || !Number.isFinite(weightTons)) {
    throw new BadRequestException("weightTons is required");
  }
  if (weightTons <= 0) throw new BadRequestException("weightTons must be more than 0");
  if (weightTons > MAX_BLOCK_TONS) {
    throw new BadRequestException(`weightTons over ${MAX_BLOCK_TONS} is not a block; check kg vs tons`);
  }
}

function supplierGstin(value?: string | null): string | null {
 const gstin=value?.trim().toUpperCase() || null;
 if(gstin && (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin) || !stateCodeFromGstin(gstin)))throw new BadRequestException("Supplier GSTIN must be a valid 15-character GSTIN");
 return gstin;
}
