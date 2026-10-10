import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PublicUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";
import {
  CREATE_ITEM_FIRST,
  HEAD_LABELS,
  OPENING_HEADS,
  readAccount,
  readBlock,
  readParty,
  readSettledAmounts,
  readSlab,
  readStockItem,
  readStore,
  type ItemKindName,
  type OpeningHeadName,
} from "./opening.input";

const ROYALTY_PER_TON = new Prisma.Decimal(336);

export interface OpeningBook {
  accounts: { id: string; name: string; kind: string; balance: string }[];
  parties: {
    id: string;
    name: string;
    kind: string;
    bankDue: string;
    cashDue: string;
    royaltyDue: string;
    transportDue: string;
  }[];
  items: { id: string; kind: string; name: string; unit: string }[];
  blocks: {
    id: string;
    itemId: string;
    blockNumber: string;
    variety: string;
    tons: string;
    ratePerTon: string;
    royaltyPerTon: string;
    value: string;
  }[];
  slabs: {
    id: string;
    itemId: string;
    variety: string;
    finish: string;
    sqft: string;
    ratePerSqft: string;
    jobWork: boolean;
    value: string | null;
  }[];
  store: {
    id: string;
    itemId: string;
    name: string;
    unit: string;
    quantity: string;
    rate: string;
    value: string;
  }[];
  settled: { head: OpeningHeadName; label: string; amount: string | null }[];
  totals: {
    money: string;
    customerBank: string;
    customerCash: string;
    advances: string;
    mineBank: string;
    mineStone: string;
    mineRoyalty: string;
    mineTransport: string;
    mineCash: string;
    staff: string;
    blockTons: string;
    blockValue: string;
    slabSqft: string;
    jobSqft: string;
    slabValue: string;
    storeValue: string;
  };
}

@Injectable()
export class OpeningService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get(actor: PublicUser): Promise<OpeningBook> {
    this.assertBooks(actor);
    return this.load(actor.factoryId);
  }

  async addAccount(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const input = readAccount(body);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.moneyAccount.findFirst({
        where: { factoryId: actor.factoryId, name: { equals: input.name, mode: "insensitive" } },
      });
      if (existing) throw new ConflictException("That account name is already open");
      await tx.moneyAccount.create({
        data: { factoryId: actor.factoryId, name: input.name, kind: input.kind, balance: input.balance },
      });
    });
    return this.load(actor.factoryId);
  }

  async addParty(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const input = readParty(body);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.partyOpening.findFirst({
        where: {
          factoryId: actor.factoryId,
          kind: input.kind,
          name: { equals: input.name, mode: "insensitive" },
        },
      });
      if (existing) throw new ConflictException("That name is already open");
      await tx.partyOpening.create({
        data: {
          factoryId: actor.factoryId,
          name: input.name,
          kind: input.kind,
          bankDue: input.bankDue,
          cashDue: input.cashDue,
          royaltyDue: input.royaltyDue,
          transportDue: input.transportDue,
        },
      });
    });
    return this.load(actor.factoryId);
  }

  async addItem(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const input = readStockItem(body);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.stockItem.findFirst({
        where: {
          factoryId: actor.factoryId,
          kind: input.kind,
          nameKey: input.name.toLowerCase(),
        },
      });
      if (existing) throw new ConflictException("That item is already created");
      await tx.stockItem.create({
        data: {
          factoryId: actor.factoryId,
          kind: input.kind,
          name: input.name,
          nameKey: input.name.toLowerCase(),
          unit: input.unit,
        },
      });
    });
    return this.load(actor.factoryId);
  }

  async addBlock(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const input = readBlock(body);
    await this.prisma.$transaction(async (tx) => {
      await this.requireItem(tx, actor.factoryId, input.itemId, "VARIETY");
      const existing = await tx.blockOpening.findFirst({
        where: {
          factoryId: actor.factoryId,
          blockNumber: { equals: input.blockNumber, mode: "insensitive" },
        },
      });
      if (existing) throw new ConflictException("That block number is already open");
      await tx.blockOpening.create({
        data: {
          factoryId: actor.factoryId,
          itemId: input.itemId,
          blockNumber: input.blockNumber,
          tons: input.tons,
          ratePerTon: input.ratePerTon,
          royaltyPerTon: input.royaltyPerTon ?? ROYALTY_PER_TON,
        },
      });
    });
    return this.load(actor.factoryId);
  }

  async addSlab(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const input = readSlab(body);
    await this.prisma.$transaction(async (tx) => {
      await this.requireItem(tx, actor.factoryId, input.itemId, "VARIETY");
      await tx.slabOpening.create({
        data: { factoryId: actor.factoryId, ...input },
      });
    });
    return this.load(actor.factoryId);
  }

  async addStore(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const input = readStore(body);
    await this.prisma.$transaction(async (tx) => {
      await this.requireItem(tx, actor.factoryId, input.itemId, "CONSUMABLE");
      const existing = await tx.storeOpening.findFirst({
        where: { factoryId: actor.factoryId, itemId: input.itemId },
      });
      if (existing) throw new ConflictException("That item is already in stock");
      await tx.storeOpening.create({ data: { factoryId: actor.factoryId, ...input } });
    });
    return this.load(actor.factoryId);
  }

  async saveSettled(actor: PublicUser, body: unknown): Promise<OpeningBook> {
    this.assertBooks(actor);
    const changes = readSettledAmounts(body);
    if (changes.length > 0) {
      await this.prisma.$transaction(
        changes.map((change) =>
          this.prisma.settledTotal.upsert({
            where: { factoryId_head: { factoryId: actor.factoryId, head: change.head } },
            create: { factoryId: actor.factoryId, head: change.head, amount: change.amount },
            update: { amount: change.amount },
          }),
        ),
      );
    }
    return this.load(actor.factoryId);
  }

  removeAccount(actor: PublicUser, id: string): Promise<OpeningBook> {
    return this.removeLine(actor, id, (factoryId, lineId) =>
      this.prisma.moneyAccount.findFirst({ where: { id: lineId, factoryId }, select: { id: true } }),
    (lineId) => this.prisma.moneyAccount.delete({ where: { id: lineId } }));
  }

  removeParty(actor: PublicUser, id: string): Promise<OpeningBook> {
    return this.removeLine(actor, id, (factoryId, lineId) =>
      this.prisma.partyOpening.findFirst({ where: { id: lineId, factoryId }, select: { id: true } }),
    (lineId) => this.prisma.partyOpening.delete({ where: { id: lineId } }));
  }

  removeBlock(actor: PublicUser, id: string): Promise<OpeningBook> {
    return this.removeLine(actor, id, (factoryId, lineId) =>
      this.prisma.blockOpening.findFirst({ where: { id: lineId, factoryId }, select: { id: true } }),
    (lineId) => this.prisma.blockOpening.delete({ where: { id: lineId } }));
  }

  removeSlab(actor: PublicUser, id: string): Promise<OpeningBook> {
    return this.removeLine(actor, id, (factoryId, lineId) =>
      this.prisma.slabOpening.findFirst({ where: { id: lineId, factoryId }, select: { id: true } }),
    (lineId) => this.prisma.slabOpening.delete({ where: { id: lineId } }));
  }

  removeStore(actor: PublicUser, id: string): Promise<OpeningBook> {
    return this.removeLine(actor, id, (factoryId, lineId) =>
      this.prisma.storeOpening.findFirst({ where: { id: lineId, factoryId }, select: { id: true } }),
    (lineId) => this.prisma.storeOpening.delete({ where: { id: lineId } }));
  }

  async removeItem(actor: PublicUser, id: string): Promise<OpeningBook> {
    this.assertBooks(actor);
    const item = await this.prisma.stockItem.findFirst({
      where: { id, factoryId: actor.factoryId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("That line is not in the books");
    const [blocks, slabs, store] = await Promise.all([
      this.prisma.blockOpening.count({ where: { itemId: item.id } }),
      this.prisma.slabOpening.count({ where: { itemId: item.id } }),
      this.prisma.storeOpening.count({ where: { itemId: item.id } }),
    ]);
    if (blocks + slabs + store > 0) {
      throw new BadRequestException("This item is in stock. Remove that stock before removing the item.");
    }
    await this.prisma.stockItem.delete({ where: { id: item.id } });
    return this.load(actor.factoryId);
  }

  private async removeLine(
    actor: PublicUser,
    id: string,
    find: (factoryId: string, id: string) => Promise<{ id: string } | null>,
    drop: (id: string) => Promise<unknown>,
  ): Promise<OpeningBook> {
    this.assertBooks(actor);
    let row: { id: string } | null = null;
    try {
      row = await find(actor.factoryId, id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new NotFoundException("That line is not in the books");
      }
      throw error;
    }
    if (!row) throw new NotFoundException("That line is not in the books");
    await drop(row.id);
    return this.load(actor.factoryId);
  }

  private assertBooks(actor: PublicUser) {
    if (actor.userType === "YARD") {
      throw new ForbiddenException("The yard does not open the books");
    }
  }

  private async requireItem(
    tx: Prisma.TransactionClient,
    factoryId: string,
    itemId: string,
    kind: ItemKindName,
  ) {
    const item = await tx.stockItem.findFirst({ where: { id: itemId, factoryId, kind } });
    if (!item) throw new BadRequestException(CREATE_ITEM_FIRST);
  }

  private async load(factoryId: string): Promise<OpeningBook> {
    const [accounts, parties, items, blocks, slabs, store, settledRows] = await Promise.all([
      this.prisma.moneyAccount.findMany({ where: { factoryId }, orderBy: { createdAt: "asc" } }),
      this.prisma.partyOpening.findMany({ where: { factoryId }, orderBy: { createdAt: "asc" } }),
      this.prisma.stockItem.findMany({ where: { factoryId }, orderBy: { createdAt: "asc" } }),
      this.prisma.blockOpening.findMany({ where: { factoryId }, include: { item: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.slabOpening.findMany({ where: { factoryId }, include: { item: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.storeOpening.findMany({ where: { factoryId }, include: { item: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.settledTotal.findMany({ where: { factoryId } }),
    ]);
    const settledByHead = new Map(settledRows.map((row) => [row.head, row.amount]));
    const totals = emptyTotals();
    for (const account of accounts) totals.money = totals.money.plus(account.balance);
    for (const party of parties) addParty(totals, party);
    for (const block of blocks) {
      totals.blockTons = totals.blockTons.plus(block.tons);
      totals.blockValue = totals.blockValue.plus(rupees(block.tons.mul(block.ratePerTon)));
    }
    for (const slab of slabs) {
      totals.slabSqft = totals.slabSqft.plus(slab.sqft);
      if (slab.jobWork) totals.jobSqft = totals.jobSqft.plus(slab.sqft);
      else totals.slabValue = totals.slabValue.plus(rupees(slab.sqft.mul(slab.ratePerSqft)));
    }
    for (const item of store) totals.storeValue = totals.storeValue.plus(rupees(item.quantity.mul(item.rate)));
    totals.mineCash = totals.mineStone.plus(totals.mineRoyalty).plus(totals.mineTransport);

    return {
      accounts: accounts.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        balance: money(row.balance),
      })),
      parties: parties.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        bankDue: money(row.bankDue),
        cashDue: money(row.cashDue),
        royaltyDue: money(row.royaltyDue),
        transportDue: money(row.transportDue),
      })),
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        unit: row.unit,
      })),
      blocks: blocks.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        blockNumber: row.blockNumber,
        variety: row.item.name,
        tons: row.tons.toFixed(3),
        ratePerTon: money(row.ratePerTon),
        royaltyPerTon: money(row.royaltyPerTon),
        value: money(rupees(row.tons.mul(row.ratePerTon))),
      })),
      slabs: slabs.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        variety: row.item.name,
        finish: row.finish,
        sqft: money(row.sqft),
        ratePerSqft: money(row.ratePerSqft),
        jobWork: row.jobWork,
        value: row.jobWork ? null : money(rupees(row.sqft.mul(row.ratePerSqft))),
      })),
      store: store.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        name: row.item.name,
        unit: row.item.unit,
        quantity: row.quantity.toFixed(3),
        rate: money(row.rate),
        value: money(rupees(row.quantity.mul(row.rate))),
      })),
      settled: OPENING_HEADS.map((head) => ({
        head,
        label: HEAD_LABELS[head],
        amount: settledByHead.has(head) ? money(settledByHead.get(head)!) : null,
      })),
      totals: {
        money: money(totals.money),
        customerBank: money(totals.customerBank),
        customerCash: money(totals.customerCash),
        advances: money(totals.advances),
        mineBank: money(totals.mineBank),
        mineStone: money(totals.mineStone),
        mineRoyalty: money(totals.mineRoyalty),
        mineTransport: money(totals.mineTransport),
        mineCash: money(totals.mineCash),
        staff: money(totals.staff),
        blockTons: totals.blockTons.toFixed(3),
        blockValue: money(totals.blockValue),
        slabSqft: money(totals.slabSqft),
        jobSqft: money(totals.jobSqft),
        slabValue: money(totals.slabValue),
        storeValue: money(totals.storeValue),
      },
    };
  }
}

function addParty(
  totals: ReturnType<typeof emptyTotals>,
  party: { kind: string; bankDue: Prisma.Decimal; cashDue: Prisma.Decimal; royaltyDue: Prisma.Decimal; transportDue: Prisma.Decimal },
) {
  if (party.kind === "CUSTOMER") {
    totals.customerBank = totals.customerBank.plus(party.bankDue);
    totals.customerCash = totals.customerCash.plus(party.cashDue);
  } else if (party.kind === "MINE") {
    totals.mineBank = totals.mineBank.plus(party.bankDue);
    totals.mineStone = totals.mineStone.plus(party.cashDue);
    totals.mineRoyalty = totals.mineRoyalty.plus(party.royaltyDue);
    totals.mineTransport = totals.mineTransport.plus(party.transportDue);
  } else if (party.kind === "STAFF") {
    totals.staff = totals.staff.plus(party.cashDue);
  } else {
    totals.advances = totals.advances.plus(party.cashDue);
  }
}

function emptyTotals() {
  return {
    money: new Prisma.Decimal(0),
    customerBank: new Prisma.Decimal(0),
    customerCash: new Prisma.Decimal(0),
    advances: new Prisma.Decimal(0),
    mineBank: new Prisma.Decimal(0),
    mineStone: new Prisma.Decimal(0),
    mineRoyalty: new Prisma.Decimal(0),
    mineTransport: new Prisma.Decimal(0),
    mineCash: new Prisma.Decimal(0),
    staff: new Prisma.Decimal(0),
    blockTons: new Prisma.Decimal(0),
    blockValue: new Prisma.Decimal(0),
    slabSqft: new Prisma.Decimal(0),
    jobSqft: new Prisma.Decimal(0),
    slabValue: new Prisma.Decimal(0),
    storeValue: new Prisma.Decimal(0),
  };
}

function rupees(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2);
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
