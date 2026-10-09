import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HISTORICAL_IMPORT_ROLES, PAYMENT_ROLES, isConsumableUnit, type Role } from "@stoneos/contracts";
import { PrismaService } from "../../common/prisma.service";
import { assertAllowedRoles } from "../../common/session.guard";
import type { AuthenticatedUser } from "../../common/current-user";
import { bankLedgerForMethod } from "./chart";
import { parseBusinessDate, parseFactoryDate, partyNameKey, rupeesToMinor } from "./money";
import { ensureParty, postVoucher } from "./posting";

export const OPENING_KINDS = ["RAW_BLOCK", "UNPOLISHED_LOT", "FINISHED_LOT", "CONSUMABLE", "DEBTOR", "CREDITOR", "CASH", "BANK"] as const;
export type OpeningRow = {
  ref: string; kind: typeof OPENING_KINDS[number]; name: string; amount: number;
  note?: string; sourceReference?: string; serial?: string; quantity?: number;
  weightTons?: number; sqftPerSlab?: number; unit?: string;
  pendingCash?: number; pendingBank?: number;
  processingStage?: string; workLocation?: string;
};
type BatchInput = { title: string; effectiveDate: string; note?: string; lines: OpeningRow[] };
type SettlementInput = { amount: number; method: string; paidAt: string; note?: string; receivedBy?: string; reference?: string; pendingBucket?: "cash" | "bank"; clientOpId: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const include = { lines: { orderBy: { ref: "asc" as const }, include: { settlements: { orderBy: { createdAt: "asc" as const } } } } };

function text(value: unknown, label: string, required = false, limit = 2000): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new BadRequestException(`${label} must be ${required ? "nonempty " : ""}text, at most ${limit} characters`);
  return value.trim();
}
function number(value: unknown, label: string, max: number, places = 2, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value === 0) || value > max || Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) > 0.00001) throw new BadRequestException(`${label} must be ${positive ? "positive" : "nonnegative"}, at most ${max}, with ${places} decimal places`);
  return value;
}
function normalize(input: BatchInput) {
  if (!input || !Array.isArray(input.lines) || input.lines.length > 1000) throw new BadRequestException("Provide at most 1000 opening lines per batch");
  const effectiveDate = text(input.effectiveDate, "Effective date", true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new BadRequestException("Effective date must be YYYY-MM-DD");
  const day = parseBusinessDate(effectiveDate, "Effective date");
  if (day.toISOString().slice(0, 10) !== effectiveDate) throw new BadRequestException("Invalid effective date");
  const seen = new Set<string>();
  const assets = new Set<string>();
  const lines = input.lines.map(row => {
    if (!row || !OPENING_KINDS.includes(row.kind)) throw new BadRequestException("Unknown opening category");
    const ref = text(row.ref, "Line reference", true, 100);
    if (seen.has(ref)) throw new BadRequestException("Duplicate line reference");
    seen.add(ref);
    const line: OpeningRow = { ref, kind: row.kind, name: text(row.name, "Name / variety", true, 200), amount: number(row.amount, "Opening value", 20000000), note: text(row.note, "Note"), sourceReference: text(row.sourceReference, "Source reference") };
    if (["DEBTOR", "CREDITOR", "CASH", "BANK"].includes(row.kind) && !line.amount) throw new BadRequestException("Financial opening amount must be positive");
    if (["RAW_BLOCK", "UNPOLISHED_LOT", "FINISHED_LOT"].includes(row.kind)) {
      line.serial = text(row.serial, "Block / lot reference", true, 200);
      const key = `stock:${line.serial}`;
      if (assets.has(key)) throw new BadRequestException("Repeated stock reference in opening batch");
      assets.add(key);
    }
    if (row.kind === "RAW_BLOCK") line.weightTons = number(row.weightTons, "Block tons", 60, 3, true);
    if (row.kind === "UNPOLISHED_LOT") {
      line.processingStage = row.processingStage ?? "rough";
      if (!["rough", "grinding", "resin", "polishing"].includes(line.processingStage)) throw new BadRequestException("Unknown unfinished-slab stage");
      line.workLocation = text(row.workLocation, "Machine / work location", false, 200);
    }
    if (["UNPOLISHED_LOT", "FINISHED_LOT"].includes(row.kind)) {
      line.quantity = number(row.quantity, "Slab count", 1000000, 0, true);
      line.sqftPerSlab = number(row.sqftPerSlab, "Sqft per slab", 999999.99, 2, true);
    }
    if (row.kind === "CONSUMABLE") {
      if (!isConsumableUnit(row.unit)) throw new BadRequestException("Consumable unit must be piece or litre");
      line.unit = row.unit;
      line.quantity = number(row.quantity, "Consumable quantity", 1000000, 3, true);
      const key = `consumable:${partyNameKey(line.name)}`;
      if (assets.has(key)) throw new BadRequestException("Repeated consumable in opening batch");
      assets.add(key);
    }
    if (["DEBTOR", "CREDITOR"].includes(row.kind)) {
      const key = `${row.kind}:${partyNameKey(line.name)}`;
      if (assets.has(key)) throw new BadRequestException("Combine this party's opening into one line");
      assets.add(key);
    }
    if (row.kind === "DEBTOR") {
      line.pendingCash = number(row.pendingCash ?? 0, "Cash pending", 20000000);
      line.pendingBank = number(row.pendingBank ?? 0, "Bank pending", 20000000);
      if (rupeesToMinor(line.pendingCash) + rupeesToMinor(line.pendingBank) > rupeesToMinor(line.amount)) throw new BadRequestException("Pending split exceeds the debtor opening balance");
    }
    return line;
  });
  return { title: text(input.title, "Batch title", true, 200), effectiveDate, note: text(input.note, "Batch note"), lines };
}

@Injectable()
export class OpeningBalancesService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  list(factoryId: string) {
    return this.prisma.openingBalanceBatch.findMany({ where: { factoryId }, include, orderBy: { createdAt: "desc" } });
  }
  private async batch(tx: Prisma.TransactionClient, user: AuthenticatedUser, id: string) {
    await tx.$queryRaw`SELECT id FROM opening_balance_batch WHERE id = ${id} AND factory_id = ${user.factoryId} FOR UPDATE`;
    const batch = await tx.openingBalanceBatch.findFirst({ where: { id, factoryId: user.factoryId }, include });
    if (!batch) throw new NotFoundException("Opening batch not found");
    return batch;
  }
  private audit(tx: Prisma.TransactionClient, user: AuthenticatedUser, action: string, entityId: string, payload: Prisma.InputJsonValue) {
    return tx.auditEvent.create({ data: { factoryId: user.factoryId, actorId: user.id, action, entityType: "opening_balance", entityId, payload } });
  }
  async create(user: AuthenticatedUser, input: BatchInput & { clientOpId: string }) {
    assertAllowedRoles(HISTORICAL_IMPORT_ROLES, user.role as Role);
    const value = normalize(input);
    const clientOpId = text(input.clientOpId, "Operation reference", true, 100);
    const requestHash = hash(value);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM factory WHERE id = ${user.factoryId} FOR UPDATE`;
      const old = await tx.openingBalanceBatch.findUnique({ where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } }, include });
      if (old) {
        if (old.requestHash !== requestHash) throw new ConflictException("Operation reference already used for different opening data");
        return old;
      }
      if (await tx.openingBalanceBatch.findFirst({ where: { factoryId: user.factoryId, status: "APPROVED" } })) throw new ConflictException("An opening batch is already approved for this factory");
      const batch = await tx.openingBalanceBatch.create({ data: { factoryId: user.factoryId, title: value.title, effectiveDate: parseFactoryDate(value.effectiveDate), note: value.note, clientOpId, requestHash, enteredByIds: [user.id], lines: { create: value.lines.map(row => ({ ref: row.ref, kind: row.kind, payload: row, amount: row.amount })) } }, include });
      await this.audit(tx, user, "opening.created", batch.id, value);
      return batch;
    });
  }
  async update(user: AuthenticatedUser, id: string, input: BatchInput & { baseVersion: number }) {
    assertAllowedRoles(HISTORICAL_IMPORT_ROLES, user.role as Role);
    const value = normalize(input);
    return this.prisma.$transaction(async tx => {
      const batch = await this.batch(tx, user, id);
      if (batch.status !== "DRAFT") throw new ConflictException("Only draft openings can be edited");
      if (input.baseVersion !== batch.version) throw new ConflictException("Opening changed; refresh before editing");
      await tx.openingBalanceLine.deleteMany({ where: { batchId: id } });
      const updated = await tx.openingBalanceBatch.update({ where: { id }, data: { title: value.title, effectiveDate: parseFactoryDate(value.effectiveDate), note: value.note, enteredByIds: [...new Set([...(batch.enteredByIds as string[]), user.id])], version: { increment: 1 }, lines: { create: value.lines.map(row => ({ ref: row.ref, kind: row.kind, payload: row, amount: row.amount })) } }, include });
      await this.audit(tx, user, "opening.updated", id, { before: { title: batch.title, date: batch.effectiveDate.toISOString(), note: batch.note, lines: batch.lines.map(l => l.payload) }, after: value });
      return updated;
    });
  }
  async transition(user: AuthenticatedUser, id: string, baseVersion: number, reopen = false) {
    assertAllowedRoles(HISTORICAL_IMPORT_ROLES, user.role as Role);
    return this.prisma.$transaction(async tx => {
      const batch = await this.batch(tx, user, id);
      const next = reopen ? "DRAFT" : "SUBMITTED";
      if (batch.status === next && batch.version === baseVersion + 1) return batch;
      if (batch.status !== (reopen ? "SUBMITTED" : "DRAFT") || batch.version !== baseVersion) throw new ConflictException("Opening status/version changed; refresh");
      if (!batch.lines.length) throw new BadRequestException("Opening batch has no lines");
      const updated = await tx.openingBalanceBatch.update({ where: { id }, data: { status: next, version: { increment: 1 } }, include });
      await this.audit(tx, user, reopen ? "opening.reopened" : "opening.submitted", id, { version: updated.version });
      return updated;
    });
  }
  async approve(user: AuthenticatedUser, id: string, input: { baseVersion: number; reconciled: boolean }) {
    assertAllowedRoles(HISTORICAL_IMPORT_ROLES, user.role as Role);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM factory WHERE id = ${user.factoryId} FOR UPDATE`;
      const batch = await this.batch(tx, user, id);
      if (batch.status === "APPROVED") return batch;
      if (batch.status !== "SUBMITTED" || batch.version !== input.baseVersion) throw new ConflictException("Opening is not awaiting approval at this version");
      if ((batch.enteredByIds as string[]).includes(user.id)) throw new ForbiddenException("A different user who did not enter or edit this batch must approve it");
      if (input.reconciled !== true) throw new BadRequestException("Confirm these entries are unrecorded and reconciled with existing stock and books");
      if (await tx.openingBalanceBatch.findFirst({ where: { factoryId: user.factoryId, status: "APPROVED" } })) throw new ConflictException("An opening batch is already approved");
      const factory = await tx.factory.findUniqueOrThrow({ where: { id: user.factoryId } });
      if (!["SETUP", "LIVE"].includes(factory.operatingStatus)) throw new ConflictException("Finish the existing opening-count workflow or unlock the factory before approving this batch");
      const day = parseFactoryDate(batch.effectiveDate.toISOString().slice(0, 10));
      for (const line of batch.lines) {
        const row = line.payload as unknown as OpeningRow;
        let partyId: string | undefined;
        let entityId: string | undefined;
        let ledger = "";
        if (["RAW_BLOCK", "UNPOLISHED_LOT", "FINISHED_LOT"].includes(row.kind)) {
          if (await tx.rawBlock.findUnique({ where: { factoryId_serialNumber: { factoryId: user.factoryId, serialNumber: row.serial! } } })) throw new ConflictException(`Stock reference ${row.serial} already exists; reconcile it rather than duplicate it`);
          const code = row.kind === "RAW_BLOCK" ? "RAW_YARD" : row.kind === "FINISHED_LOT" ? "FINISHED_STOCK" : row.processingStage && row.processingStage !== "rough" ? "LPM_WIP" : "UNPOLISHED_STOCK";
          const location = await tx.inventoryLocation.upsert({ where: { factoryId_code: { factoryId: user.factoryId, code } }, update: {}, create: { factoryId: user.factoryId, code, name: code.replaceAll("_", " "), locationType: code as "RAW_YARD" | "FINISHED_STOCK" | "UNPOLISHED_STOCK" | "LPM_WIP" } });
          const block = await tx.rawBlock.create({ data: { factoryId: user.factoryId, serialNumber: row.serial!, varietyName: row.name, weightTons: row.weightTons, purchaseTaxable: row.amount, purchaseDate: day, openingReference: line.id, qualityNote: [row.processingStage ? `Opening stage: ${row.processingStage}` : "", row.workLocation, row.note, row.sourceReference].filter(Boolean).join(" · "), locationId: location.id, currentStatus: row.kind === "RAW_BLOCK" ? "in_stock" : "cut", goodSlabCount: row.quantity ?? 0, polishedSlabCount: row.kind === "FINISHED_LOT" ? row.quantity! : 0, sqftPerSlab: row.sqftPerSlab, createdAt: day } });
          entityId = block.id;
          await tx.inventoryMovement.create({ data: { factoryId: user.factoryId, rawBlockId: block.id, movementType: "OPENING_RECEIPT", quantity: row.quantity ?? 1, idempotencyKey: `opening-balance:${line.id}`, actorId: user.id, notes: `Opening ${batch.title}: ${row.note ?? ""}`, createdAt: day } });
          ledger = row.kind === "RAW_BLOCK" ? "RAW_STOCK" : row.kind === "FINISHED_LOT" ? "STOCK" : "WIP_STOCK";
        } else if (row.kind === "CONSUMABLE") {
          const matches = (await tx.consumable.findMany({ where: { factoryId: user.factoryId } })).filter(c => partyNameKey(c.name) === partyNameKey(row.name));
          if (matches.length > 1) throw new ConflictException("Ambiguous consumable name");
          const existing = matches[0];
          if (existing && existing.unit !== row.unit) throw new ConflictException("Consumable unit differs from existing stock");
          const item = existing ?? await tx.consumable.create({ data: { factoryId: user.factoryId, name: row.name, unit: row.unit! } });
          await tx.consumable.update({ where: { id: item.id }, data: { onHand: { increment: row.quantity! } } });
          await tx.consumableMovement.create({ data: { factoryId: user.factoryId, consumableId: item.id, direction: "receipt", quantity: row.quantity!, reason: `Opening ${batch.title}: ${row.note ?? ""}`, occurredOn: day, actorId: user.id, clientOpId: `opening-balance:${line.id}` } });
          entityId = item.id;
          ledger = "CONSUMABLE_STOCK";
        } else if (["DEBTOR", "CREDITOR"].includes(row.kind)) {
          const party = await ensureParty(tx, user.factoryId, row.name, row.kind === "DEBTOR" ? "customer" : "supplier");
          partyId = party.id;
          if (row.kind === "DEBTOR") {
            const matches = (await tx.customer.findMany({ where: { factoryId: user.factoryId } })).filter(c => partyNameKey(c.name) === partyNameKey(row.name));
            if (matches.length > 1) throw new ConflictException("Ambiguous customer name");
            const customer = matches[0] ?? await tx.customer.create({ data: { factoryId: user.factoryId, name: row.name } });
            await tx.customer.update({ where: { id: customer.id }, data: { pendingCash: { increment: row.pendingCash ?? 0 }, pendingBank: { increment: row.pendingBank ?? 0 }, version: { increment: 1 } } });
            entityId = customer.id;
            ledger = "AR";
          } else {
            const matches = (await tx.supplier.findMany({ where: { factoryId: user.factoryId } })).filter(c => partyNameKey(c.name) === partyNameKey(row.name));
            if (matches.length > 1) throw new ConflictException("Ambiguous supplier name");
            const supplier = matches[0] ?? await tx.supplier.create({ data: { factoryId: user.factoryId, name: row.name } });
            entityId = supplier.id;
            ledger = "AP";
          }
        } else ledger = row.kind === "CASH" ? "CASH" : "BANK_OTHER";
        await tx.openingBalanceLine.update({ where: { id: line.id }, data: { partyId, entityId } });
        const amount = rupeesToMinor(row.amount);
        if (amount > 0) await postVoucher(tx, { factoryId: user.factoryId, createdBy: user.id, type: "opening", source: "manual", sourceId: line.id, partyId, clientOpId: `opening-balance:${line.id}`, operationalDate: day, memo: [batch.title, row.name, row.sourceReference, row.note].filter(Boolean).join(" · "), lines: row.kind === "CREDITOR" ? [{ ledgerCode: "OPENING_EQUITY", debit: amount, credit: 0 }, { ledgerCode: ledger, debit: 0, credit: amount, partyId }] : [{ ledgerCode: ledger, debit: amount, credit: 0, partyId }, { ledgerCode: "OPENING_EQUITY", debit: 0, credit: amount }] });
      }
      await tx.factory.updateMany({ where: { id: user.factoryId, operatingStatus: "SETUP" }, data: { operatingStatus: "LIVE", goLiveDate: day, version: { increment: 1 } } });
      const approved = await tx.openingBalanceBatch.update({ where: { id }, data: { status: "APPROVED", reconciled: true, approvedById: user.id, approvedAt: new Date(), version: { increment: 1 } }, include });
      await this.audit(tx, user, "opening.approved", id, { effectiveDate: batch.effectiveDate.toISOString(), lineCount: batch.lines.length, reconciled: true });
      return approved;
    }, { timeout: 120000 });
  }
  async settle(user: AuthenticatedUser, lineId: string, input: SettlementInput) {
    assertAllowedRoles(PAYMENT_ROLES, user.role as Role);
    const value = { amount: number(input.amount, "Payment amount", 20000000, 2, true), method: text(input.method, "Payment mode", true, 100), paidAt: text(input.paidAt, "Payment date", true, 10), note: text(input.note, "Payment note"), receivedBy: text(input.receivedBy, "Received by / paid to"), reference: text(input.reference, "Payment reference"), pendingBucket: input.pendingBucket ?? null, lineId };
    if (value.pendingBucket !== null && !["cash", "bank"].includes(value.pendingBucket)) throw new BadRequestException("Unknown pending bucket");
    const paidAt = parseBusinessDate(value.paidAt, "Payment date");
    if (paidAt.toISOString().slice(0, 10) !== value.paidAt) throw new BadRequestException("Invalid payment date");
    const clientOpId = text(input.clientOpId, "Operation reference", true, 100);
    const requestHash = hash(value);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT l.id FROM opening_balance_line l JOIN opening_balance_batch b ON b.id=l.batch_id WHERE l.id=${lineId} AND b.factory_id=${user.factoryId} FOR UPDATE OF l`;
      const line = await tx.openingBalanceLine.findFirst({ where: { id: lineId, batch: { factoryId: user.factoryId, status: "APPROVED" } }, include: { batch: true } });
      if (!line || !["DEBTOR", "CREDITOR"].includes(line.kind)) throw new NotFoundException("Approved debtor/creditor opening line not found");
      const old = await tx.openingSettlement.findUnique({ where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } } });
      if (old) {
        if (old.requestHash !== requestHash) throw new ConflictException("Operation reference already used for a different settlement");
        return old;
      }
      if (value.paidAt < line.batch.effectiveDate.toISOString().slice(0, 10)) throw new BadRequestException("Payment cannot predate the opening balance");
      if (rupeesToMinor(value.amount) > rupeesToMinor(Number(line.amount)) - rupeesToMinor(Number(line.settledAmount))) throw new BadRequestException("Payment exceeds the remaining opening balance");
      if (value.pendingBucket) {
        if (line.kind !== "DEBTOR") throw new BadRequestException("Pending split allocation applies to debtor receipts only");
        await tx.$queryRaw`SELECT id FROM customer WHERE id=${line.entityId} AND factory_id=${user.factoryId} FOR UPDATE`;
        const customer = await tx.customer.findFirst({ where: { id: line.entityId!, factoryId: user.factoryId } });
        if (!customer) throw new NotFoundException("Customer not found");
        const field = value.pendingBucket === "cash" ? "pendingCash" : "pendingBank";
        if (rupeesToMinor(value.amount) > rupeesToMinor(Number(customer[field]))) throw new BadRequestException("Receipt exceeds the selected pending portion");
        await tx.customer.update({ where: { id: customer.id }, data: { [field]: { decrement: value.amount }, version: { increment: 1 } } });
      }
      const payment = await tx.openingSettlement.create({ data: { factoryId: user.factoryId, lineId, amount: value.amount, method: value.method, paidAt, note: value.note, receivedBy: value.receivedBy, reference: value.reference, pendingBucket: value.pendingBucket, clientOpId, requestHash } });
      await tx.openingBalanceLine.update({ where: { id: lineId }, data: { settledAmount: { increment: value.amount } } });
      const amount = rupeesToMinor(value.amount), bank = bankLedgerForMethod(value.method);
      await postVoucher(tx, { factoryId: user.factoryId, createdBy: user.id, type: line.kind === "DEBTOR" ? "receipt" : "payment", source: "manual", sourceId: payment.id, partyId: line.partyId!, clientOpId: `opening-settlement:${payment.id}`, operationalDate: paidAt, memo: [line.kind === "DEBTOR" ? "Opening collection" : "Opening creditor payment", value.method, value.receivedBy ? `Received by / paid to: ${value.receivedBy}` : "", value.reference ? `Reference: ${value.reference}` : "", value.note].filter(Boolean).join(" · "), lines: line.kind === "DEBTOR" ? [{ ledgerCode: bank, debit: amount, credit: 0 }, { ledgerCode: "AR", debit: 0, credit: amount, partyId: line.partyId! }] : [{ ledgerCode: "AP", debit: amount, credit: 0, partyId: line.partyId! }, { ledgerCode: bank, debit: 0, credit: amount }] });
      await this.audit(tx, user, "opening.settled", payment.id, value);
      return payment;
    }, { timeout: 30000 });
  }
}
