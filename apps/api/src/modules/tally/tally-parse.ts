export type TallyVoucher = {
  type: string;
  number: string;
  date: string;
  party: string;
  amount: number;
  ledgers: string[];
};

export type TallyDaybookSummary = {
  vouchers: number;
  ledgers: string[];
  byType: Record<string, number>;
  totalAbsAmount: number;
  entries: TallyVoucher[];
  writesInventory: false;
};

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>\\s*([^<]*)\\s*</${name}>`, "i"));
  return (match?.[1] ?? "").trim();
}

function amounts(block: string): number[] {
  return [...block.matchAll(/<AMOUNT>\s*([^<]+)\s*<\/AMOUNT>/gi)]
    .map((m) => Number(String(m[1]).replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** Parse Tally daybook XML into voucher rows. Never posts StoneOS stock or money. */
export function parseDaybookXml(xml: string): TallyDaybookSummary {
  const blocks = xml.split(/<VOUCHER[\s>]/i).slice(1);
  const entries: TallyVoucher[] = [];
  const ledgerSet = new Set<string>();
  const byType: Record<string, number> = {};
  let totalAbsAmount = 0;

  for (const raw of blocks) {
    const block = raw.split(/<\/VOUCHER>/i)[0] ?? raw;
    const type = tag(block, "VOUCHERTYPENAME") || "Unknown";
    const number = tag(block, "VOUCHERNUMBER");
    const date = tag(block, "DATE");
    const party = tag(block, "PARTYLEDGERNAME");
    const ledgers = [...block.matchAll(/<LEDGERNAME>\s*([^<]+)\s*<\/LEDGERNAME>/gi)].map((m) =>
      (m[1] ?? "").trim(),
    );
    for (const name of ledgers) if (name) ledgerSet.add(name);
    const nums = amounts(block);
    const amount = nums.reduce((max, n) => (Math.abs(n) > Math.abs(max) ? n : max), 0);
    totalAbsAmount += Math.abs(amount);
    byType[type] = (byType[type] ?? 0) + 1;
    entries.push({ type, number, date, party, amount, ledgers: [...new Set(ledgers.filter(Boolean))] });
  }

  return {
    vouchers: entries.length,
    ledgers: [...ledgerSet].sort(),
    byType,
    totalAbsAmount,
    entries: entries.slice(0, 500),
    writesInventory: false,
  };
}
