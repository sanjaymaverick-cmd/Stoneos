import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readName } from "../auth/input";

const MONEY_MAX = "999999999999.99";
const QTY_MAX = "99999999999.999";
const TONS_MAX = "999999999.999";

export const OPENING_HEADS = [
  "CAPITAL",
  "CONSTRUCTION",
  "GST_INPUT_CLAIMED",
  "SUBSIDY_RECEIVED",
  "ICICI_PRINCIPAL_REPAID",
  "ICICI_INTEREST_PAID",
  "CC_INTEREST_PAID",
  "MARKET_INTEREST_PAID",
  "WPPF_WITHDRAWN",
  "PPF_WITHDRAWN",
  "SOLAR_PAID",
] as const;

export type OpeningHeadName = (typeof OPENING_HEADS)[number];

export const HEAD_LABELS: Record<OpeningHeadName, string> = {
  CAPITAL: "Capital put in",
  CONSTRUCTION: "Construction spent",
  GST_INPUT_CLAIMED: "GST input already claimed",
  SUBSIDY_RECEIVED: "Interest subsidy already received",
  ICICI_PRINCIPAL_REPAID: "ICICI principal repaid",
  ICICI_INTEREST_PAID: "ICICI interest paid",
  CC_INTEREST_PAID: "Cash credit interest paid",
  MARKET_INTEREST_PAID: "Market-loan interest paid",
  WPPF_WITHDRAWN: "Working partners' profit withdrawn",
  PPF_WITHDRAWN: "Partner profit withdrawn",
  SOLAR_PAID: "Solar interest and principal paid",
};

const FINISHES = ["Polish", "Lapotra", "Rough", "Honed", "Leather"] as const;

export const CREATE_ITEM_FIRST = "Create this item first, then add it to stock.";

export type AccountKindName = "CASH" | "BANK" | "UPI";
export type PartyKindName = "CUSTOMER" | "MINE" | "STAFF" | "ADVANCE";
export type ItemKindName = "VARIETY" | "CONSUMABLE";

export function readMoney(value: unknown, label: string): Prisma.Decimal {
  return readScaled(value, label, 2, MONEY_MAX);
}

export function readTons(value: unknown, label: string): Prisma.Decimal {
  return readScaled(value, label, 3, TONS_MAX);
}

export function readQty(value: unknown, label: string): Prisma.Decimal {
  return readScaled(value, label, 3, QTY_MAX);
}

export function readAccount(body: unknown): {
  name: string;
  kind: AccountKindName;
  balance: Prisma.Decimal;
} {
  const record = asRecord(body);
  return {
    name: readName(record.name, "Name"),
    kind: readAccountKind(record.kind),
    balance: readMoney(record.balance, "Opening balance"),
  };
}

export function readParty(body: unknown): {
  name: string;
  kind: PartyKindName;
  bankDue: Prisma.Decimal;
  cashDue: Prisma.Decimal;
  royaltyDue: Prisma.Decimal;
  transportDue: Prisma.Decimal;
} {
  const record = asRecord(body);
  const kind = readPartyKind(record.kind);
  const party = {
    name: readName(record.name, "Name"),
    kind,
    bankDue: readMoneyOrZero(record.bankDue, "Bank due"),
    cashDue: readMoneyOrZero(record.cashDue, kind === "STAFF" ? "Amount owed" : kind === "ADVANCE" ? "Amount paid" : "Cash due"),
    royaltyDue: readMoneyOrZero(record.royaltyDue, "Royalty"),
    transportDue: readMoneyOrZero(record.transportDue, "Transport"),
  };
  assertPartyShape(party);
  return party;
}

export function readStockItem(body: unknown): {
  kind: ItemKindName;
  name: string;
  unit: string;
} {
  const record = asRecord(body);
  const kind = readItemKind(record.kind);
  return {
    kind,
    name: readName(record.name, "Name"),
    unit: kind === "CONSUMABLE" ? readUnit(record.unit) : "",
  };
}

export function readBlock(body: unknown): {
  itemId: string;
  blockNumber: string;
  tons: Prisma.Decimal;
  ratePerTon: Prisma.Decimal;
  royaltyPerTon: Prisma.Decimal | null;
} {
  const record = asRecord(body);
  const tons = readTons(record.tons, "Tons");
  if (tons.lessThanOrEqualTo(0)) throw new BadRequestException("Tons must be more than zero");
  return {
    itemId: readItemId(record.itemId),
    blockNumber: readBlockNumber(record.blockNumber),
    tons,
    ratePerTon: readMoney(record.ratePerTon, "Rate per ton"),
    royaltyPerTon: readOptionalMoney(record.royaltyPerTon, "Royalty per ton"),
  };
}

export function readSlab(body: unknown): {
  itemId: string;
  finish: string;
  sqft: Prisma.Decimal;
  ratePerSqft: Prisma.Decimal;
  jobWork: boolean;
} {
  const record = asRecord(body);
  const sqft = readMoney(record.sqft, "Sqft");
  if (sqft.lessThanOrEqualTo(0)) throw new BadRequestException("Sqft must be more than zero");
  return {
    itemId: readItemId(record.itemId),
    finish: readFinish(record.finish),
    sqft,
    ratePerSqft: readMoney(record.ratePerSqft, "Rate per sqft"),
    jobWork: readJobWork(record.jobWork),
  };
}

export function readStore(body: unknown): {
  itemId: string;
  quantity: Prisma.Decimal;
  rate: Prisma.Decimal;
} {
  const record = asRecord(body);
  const quantity = readQty(record.quantity, "Quantity");
  if (quantity.lessThanOrEqualTo(0)) throw new BadRequestException("Quantity must be more than zero");
  return {
    itemId: readItemId(record.itemId),
    quantity,
    rate: readMoney(record.rate, "Rate"),
  };
}

export function readSettledAmounts(body: unknown): { head: OpeningHeadName; amount: Prisma.Decimal }[] {
  const record = asRecord(body);
  if (!isRecord(record.amounts)) throw new BadRequestException("Enter the settled amounts");
  const changes: { head: OpeningHeadName; amount: Prisma.Decimal }[] = [];
  for (const head of OPENING_HEADS) {
    if (!(head in record.amounts)) continue;
    const value = record.amounts[head];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    changes.push({ head, amount: readMoney(value, HEAD_LABELS[head]) });
  }
  return changes;
}

export function readBlockNumber(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Block number is required");
  const blockNumber = value.trim().replace(/\s+/g, " ");
  if (blockNumber.length < 1 || blockNumber.length > 40) {
    throw new BadRequestException("Block number must be 1 to 40 characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(blockNumber)) {
    throw new BadRequestException("Block number can use letters, numbers, and a hyphen");
  }
  return blockNumber;
}

export function readItemId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new BadRequestException(CREATE_ITEM_FIRST);
  }
  return value.trim();
}

export function readFinish(value: unknown): (typeof FINISHES)[number] {
  if (typeof value !== "string") throw new BadRequestException("Choose a finish");
  const finish = FINISHES.find((item) => item.toLowerCase() === value.trim().toLowerCase());
  if (!finish) throw new BadRequestException("Choose Polish, Lapotra, Rough, Honed, or Leather");
  return finish;
}

function readItemKind(value: unknown): ItemKindName {
  if (value === "VARIETY" || value === "CONSUMABLE") return value;
  throw new BadRequestException("Choose a variety or a consumable");
}

function readAccountKind(value: unknown): AccountKindName {
  if (value === "CASH" || value === "BANK" || value === "UPI") return value;
  throw new BadRequestException("Choose Cash, Bank, or UPI");
}

function readPartyKind(value: unknown): PartyKindName {
  if (value === "CUSTOMER" || value === "MINE" || value === "STAFF" || value === "ADVANCE") return value;
  throw new BadRequestException("Choose Customer, Mine, Staff, or Advance");
}

function readUnit(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Unit is required");
  const unit = value.trim();
  if (unit.length < 1 || unit.length > 16) {
    throw new BadRequestException("Unit must be 1 to 16 characters");
  }
  return unit;
}

function readJobWork(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  throw new BadRequestException("Job work must be yes or no");
}

function assertPartyShape(party: {
  kind: PartyKindName;
  bankDue: Prisma.Decimal;
  cashDue: Prisma.Decimal;
  royaltyDue: Prisma.Decimal;
  transportDue: Prisma.Decimal;
}) {
  const bank = party.bankDue.greaterThan(0);
  const royalty = party.royaltyDue.greaterThan(0);
  const transport = party.transportDue.greaterThan(0);
  if (party.kind === "CUSTOMER" && (royalty || transport)) {
    throw new BadRequestException("A customer has a bank due and a cash due");
  }
  if (party.kind === "STAFF" && (bank || royalty || transport)) {
    throw new BadRequestException("Staff and other parties have one amount owed");
  }
  if (party.kind === "ADVANCE" && (bank || royalty || transport)) {
    throw new BadRequestException("An advance is the amount already paid out");
  }
  const owed = party.bankDue.plus(party.cashDue).plus(party.royaltyDue).plus(party.transportDue);
  if (owed.lessThanOrEqualTo(0)) throw new BadRequestException("Enter an amount");
}

function readMoneyOrZero(value: unknown, label: string): Prisma.Decimal {
  if (value === undefined || value === null) return new Prisma.Decimal(0);
  if (typeof value === "string" && value.trim() === "") return new Prisma.Decimal(0);
  return readMoney(value, label);
}

function readOptionalMoney(value: unknown, label: string): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return readMoney(value, label);
}

function readScaled(value: unknown, label: string, scale: 2 | 3, max: string): Prisma.Decimal {
  if (typeof value !== "string") throw new BadRequestException(`${label} is required`);
  const raw = value.trim().replace(/[₹,\s]/g, "");
  if (!raw) throw new BadRequestException(`${label} is required`);
  const pattern = scale === 3 ? /^\d+(\.\d{1,3})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(raw)) {
    throw new BadRequestException(
      scale === 3 ? `${label} can use up to 3 decimal places` : `${label} can use up to 2 decimal places`,
    );
  }
  const amount = new Prisma.Decimal(raw);
  if (amount.greaterThan(max)) throw new BadRequestException(`${label} is too large`);
  return amount;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new BadRequestException("Enter the line");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
