import type { LedgerGroup, LedgerKind, Prisma } from "@prisma/client";

export const SYSTEM_LEDGERS: Array<{
  code: string;
  name: string;
  group: LedgerGroup;
  kind: LedgerKind;
}> = [
  { code: "CASH", name: "Cash", group: "asset", kind: "cash" },
  { code: "BANK_ICICI", name: "ICICI", group: "asset", kind: "bank" },
  { code: "BANK_AXIS", name: "Axis", group: "asset", kind: "bank" },
  { code: "BANK_NEMA", name: "Nema", group: "asset", kind: "bank" },
  { code: "BANK_SHREECHAND", name: "Shreechand", group: "asset", kind: "bank" },
  { code: "BANK_OTHER", name: "Other bank / UPI", group: "asset", kind: "bank" },
  { code: "AR", name: "Accounts receivable", group: "asset", kind: "ar" },
  { code: "AP", name: "Accounts payable", group: "liability", kind: "ap" },
  { code: "SALES", name: "Sales", group: "income", kind: "sales" },
  { code: "CN_CONTRA", name: "Credit notes", group: "income", kind: "sales" },
  { code: "GST_OUTPUT", name: "GST output (file GSTR outside)", group: "liability", kind: "gst" },
  { code: "EXP_DIESEL", name: "Diesel", group: "expense", kind: "expense" },
  { code: "EXP_FREIGHT", name: "Freight", group: "expense", kind: "expense" },
  { code: "EXP_LABOUR", name: "Labour", group: "expense", kind: "expense" },
  { code: "EXP_LOADING", name: "Loading", group: "expense", kind: "expense" },
  { code: "EXP_MISC", name: "Misc expense", group: "expense", kind: "expense" },
  { code: "OPENING_EQUITY", name: "Opening equity", group: "liability", kind: "opening_equity" },
];

export async function ensureChart(tx: Prisma.TransactionClient, factoryId: string) {
  for (const row of SYSTEM_LEDGERS) {
    await tx.ledger.upsert({
      where: { factoryId_code: { factoryId, code: row.code } },
      update: { name: row.name, group: row.group, kind: row.kind, isSystem: true },
      create: { factoryId, ...row, isSystem: true },
    });
  }
}

export function bankLedgerForMethod(method: string): string {
  const m = method.trim().toLowerCase();
  if (m === "cash") return "CASH";
  if (m.includes("icici")) return "BANK_ICICI";
  if (m.includes("axis")) return "BANK_AXIS";
  if (m.includes("nema")) return "BANK_NEMA";
  if (m.includes("shreechand") || m.includes("shree chand")) return "BANK_SHREECHAND";
  return "BANK_OTHER";
}

export function expenseLedgerForCategory(category: string): string {
  const c = category.trim().toLowerCase();
  if (c === "diesel") return "EXP_DIESEL";
  if (c === "transport" || c === "freight") return "EXP_FREIGHT";
  if (c === "wages" || c === "labour") return "EXP_LABOUR";
  if (c === "loading") return "EXP_LOADING";
  return "EXP_MISC";
}

export function expenseCategoryFromParticulars(particulars: string): string {
  const p = particulars.trim().toLowerCase();
  if (p.includes("diesel")) return "diesel";
  if (p.includes("load")) return "loading";
  if (p.includes("freight") || p.includes("transport")) return "transport";
  if (p.includes("labour") || p.includes("wages") || p.includes("job")) return "wages";
  if (p.includes("tea") || p.includes("misc")) return "other";
  return "other";
}
