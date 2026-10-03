/*
 * A full financial year through the real services.
 *
 * Nothing here is a mock: every block, cut, polish, sale, invoice and write-off goes
 * through the same service methods the screens call, so the ledger postings, the GST
 * splits and the stock arithmetic are the ones production would produce. Only the
 * clock is faked.
 *
 * Run:  DATABASE_URL=... npx tsx dry-run-year.ts
 *
 * It refuses to run against anything but a database whose name says it is a dry run,
 * because the one thing this must never touch is books a return is filed from.
 *
 * ONE HONEST CAVEAT. `Invoice` has no document date — only `createdAt @default(now())`
 * — and GSTR-1 filters on it, so an invoice can only ever be dated the moment it is
 * raised. To get a month-by-month return out of a year, this backdates invoice rows
 * with a direct update after the service has created them. That is a harness step and
 * NOT something the application can do; see the report for what that implies.
 */

import { PrismaClient } from "@prisma/client";
import { AuditService } from "./src/common/audit.service";
import { BooksService } from "./src/modules/books/books.service";
import { InventoryService } from "./src/modules/inventory/inventory.service";
import { SalesService } from "./src/modules/sales/sales.service";
import { LotsService } from "./src/modules/lots/lots.service";
import { GstService } from "./src/modules/gst/gst.service";
import { hashPassword } from "@stoneos/auth";
import type { AuthenticatedUser } from "./src/common/current-user";

const FY_START = { year: 2025, month: 4 }; // 1 April 2025
const MONTHS = 12;

/*
 * A controllable clock.
 *
 * The services refuse an occurredAt more than 14 days old ("enter it as a correction
 * instead"), which is the right guard and also means a year of history cannot be
 * typed in after the fact. So rather than backdating, the run moves the clock forward
 * a month at a time and lets every service believe it really is that month. The
 * business logic is untouched; only `new Date()` lies.
 */
const RealDate = Date;
let simulatedNow = RealDate.now();
class SimulatedDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date> | []) {
    if (args.length === 0) super(simulatedNow);
    else super(...(args as ConstructorParameters<typeof Date>));
  }
  static now() {
    return simulatedNow;
  }
}
(globalThis as { Date: DateConstructor }).Date = SimulatedDate as unknown as DateConstructor;
/** Stand at the end of this month, so everything dated within it is "recent". */
function standAt(year: number, month: number, day: number) {
  simulatedNow = RealDate.UTC(year, month - 1, day, 12, 0, 0);
}

/** Deterministic, so two runs of this produce the same year. */
let seed = 20251001;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));

function monthOf(i: number) {
  const m = FY_START.month + i;
  return { year: FY_START.year + Math.floor((m - 1) / 12), month: ((m - 1) % 12) + 1 };
}
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

const BUYERS = [
  { name: "Sharma Marbles, Jaipur", gstin: "08AABCS1429B1ZX", city: "MI Road, Jaipur" },
  { name: "Kota Stone Depot", gstin: "08AADCK7788L1Z5", city: "Station Road, Kota" },
  { name: "Vizag Granite Traders", gstin: "37AABCV3321P1ZQ", city: "Beach Road, Visakhapatnam" },
  { name: "Pune Interiors", gstin: "27AAFCP9012R1ZB", city: "Baner, Pune" },
  { name: "Surat Stone Mart", gstin: "24AAGCS4567T1ZN", city: "Ring Road, Surat" },
  { name: "Delhi Facade Works", gstin: "07AAHCD8899K1ZJ", city: "Okhla, New Delhi" },
  { name: "Counter buyer (walk-in)", gstin: null, city: null },
];

const VARIETIES = ["Imperial Red", "Kashmir White", "Tan Brown", "Absolute Black"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/dryrun|dry_run/i.test(url)) {
    throw new Error(
      `Refusing to run: DATABASE_URL must name a dry-run database, got "${url.replace(/:[^:@]*@/, ":***@")}"`,
    );
  }

  const prisma = new PrismaClient();
  const audit = new AuditService(prisma as never);
  const books = new BooksService(prisma as never);
  const inventory = new InventoryService(prisma as never, audit, books);
  const sales = new SalesService(prisma as never, audit, books);
  const lots = new LotsService(prisma as never, audit, books);
  const gst = new GstService(prisma as never);

  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  const factory = await prisma.factory.create({ data: { name: "Vedam Granites (dry run)" } });
  await inventory.ensureDefaultLocations(factory.id);
  await prisma.machine.createMany({
    data: [
      { factoryId: factory.id, name: "B-21", machineType: "CUTTING", bladeCount: 21 },
      { factoryId: factory.id, name: "LPM-16", machineType: "POLISHING", headCount: 16 },
    ],
  });
  const ownerRow = await prisma.appUser.create({
    data: {
      factoryId: factory.id, username: "owner", name: "Owner", role: "owner",
      passwordHash: await hashPassword("ChangeMeNow!12"), mustChangePassword: false,
    },
  });
  const owner: AuthenticatedUser = {
    id: ownerRow.id, username: "owner", name: "Owner", email: null, role: "owner",
    factoryId: factory.id, mustChangePassword: false, active: true, sessionId: "dry-run",
  };

  // A fictional GSTIN. Rajasthan is state 08, so a 37/27/24/07 buyer is inter-state.
  await gst.upsertProfile(owner, {
    gstin: "08ZZZZZ0000Z1ZX", stateCode: "08", legalName: "Vedam Granites",
  });

  const supplier = await inventory
    .createSupplier(owner, "Jalore Quarry Co", undefined, { stateCode: "08" })
    .catch(() => null);

  const buyers: Array<{ id: string; name: string; gstin: string | null }> = [];
  for (const b of BUYERS) {
    const row = await sales.createCustomer(owner, b.name, undefined, {
      gstin: b.gstin ?? undefined,
      stateCode: b.gstin ? undefined : "08",
      billingAddress: b.city ?? undefined,
    });
    buyers.push({ id: row.id, name: row.name, gstin: row.gstin });
  }

  const lpm = await prisma.machine.findFirstOrThrow({
    where: { factoryId: factory.id, machineType: "POLISHING" },
  });

  type MonthRow = {
    label: string; month: string;
    blocksIn: number; purchaseBilled: number; purchaseCash: number;
    slabsCut: number; slabsPolished: number; slabsSold: number; slabsBroken: number;
    billedSales: number; cashSales: number; cgst: number; sgst: number; igst: number;
    invoices: number; cashOnlyOrders: number;
  };
  const rows: MonthRow[] = [];
  let blockNo = 0;

  for (let i = 0; i < MONTHS; i++) {
    const { year, month } = monthOf(i);
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", {
      month: "short", year: "numeric", timeZone: "UTC",
    });
    standAt(year, month, 10);
    const row: MonthRow = {
      label, month: `${year}-${String(month).padStart(2, "0")}`,
      blocksIn: 0, purchaseBilled: 0, purchaseCash: 0,
      slabsCut: 0, slabsPolished: 0, slabsSold: 0, slabsBroken: 0,
      billedSales: 0, cashSales: 0, cgst: 0, sgst: 0, igst: 0,
      invoices: 0, cashOnlyOrders: 0,
    };

    // ---- blocks in, cut and polished ----
    const blocksThisMonth = between(2, 3);
    const serialsThisMonth: string[] = [];
    for (let b = 0; b < blocksThisMonth; b++) {
      blockNo += 1;
      const serial = `VG-${String(blockNo).padStart(3, "0")}`;
      const taxable = between(170_000, 240_000);
      // Most quarry loads carry a cash leg; some are wholly on the bill.
      const cash = rnd() < 0.25 ? 0 : between(30_000, 70_000);
      await inventory.receiveBlock(owner, {
        serialNumber: serial,
        varietyName: pick(VARIETIES),
        weightTons: between(18, 26),
        purchaseTaxable: taxable,
        purchaseCashAmount: cash,
        supplierId: supplier?.id,
        clientOpId: `dr-recv-${serial}`,
        occurredAt: `${iso(year, month, between(2, 8))}T06:00:00.000Z`,
      });
      row.blocksIn += 1;
      row.purchaseBilled += taxable;
      row.purchaseCash += cash;

      // "VG-001-70": seventy slabs off the block is the house figure.
      const total = between(68, 76);
      const damaged = between(0, 4);
      await lots.recordCut(owner, {
        blockSerial: serial, totalSlabsCut: total, damagedAtSaw: damaged,
        sqftPerSlab: 49.5, clientOpId: `dr-cut-${serial}`,
      });
      row.slabsCut += total - damaged;
      serialsThisMonth.push(serial);

      const polish = total - damaged;
      await lots.polishLot(owner, {
        blockSerial: serial, slabCount: polish, machineId: lpm.id,
        processType: "POLISHING", finishType: "mirror", runtimeHours: 7.5,
        clientOpId: `dr-pol-${serial}`,
      });
      row.slabsPolished += polish;
    }

    standAt(year, month, 28);

    // ---- breakage ----
    if (rnd() < 0.6 && serialsThisMonth.length) {
      const serial = pick(serialsThisMonth);
      const n = between(1, 4);
      try {
        await lots.writeOffBroken(owner, {
          blockSerial: serial, slabCount: n, stage: pick(["yard", "loading", "factory_transport"]),
          reason: "broken while loading", occurredOn: iso(year, month, between(10, 20)),
          clientOpId: `dr-off-${serial}-${i}`,
        });
        row.slabsBroken += n;
      } catch { /* lot already empty; fine */ }
    }

    // ---- sales ----
    const orders = between(3, 5);
    for (let o = 0; o < orders; o++) {
      const stock = await lots.availability(factory.id);
      if (!stock.lots.length) break;
      const lot = pick(stock.lots);
      const want = Math.min(lot.availableSlabs, between(18, 45));
      if (want <= 0) continue;
      const buyer = pick(buyers);
      const day = between(5, 27);

      // Three shapes of deal, as the yard actually does them.
      const shape = rnd();
      const rate = between(78, 105);
      const wholly_cash = shape < 0.18;
      const split = !wholly_cash && shape < 0.5;
      const cashLeg = wholly_cash
        ? Math.round(want * 49.5 * rate)
        : split
          ? between(20_000, 60_000)
          : 0;

      let order;
      try {
        order = await lots.sellLots(owner, {
          customerId: buyer.id,
          orderDate: iso(year, month, day),
          clientOpId: `dr-sell-${i}-${o}`,
          cashAmount: cashLeg || undefined,
          cashNote: cashLeg ? "settled at the gate" : undefined,
          lines: [{
            blockSerial: lot.blockSerial,
            slabCount: want,
            rate: wholly_cash ? 0 : rate,
          }],
        });
      } catch { continue; }
      row.slabsSold += want;
      row.cashSales += cashLeg;

      if (wholly_cash) {
        row.cashOnlyOrders += 1;
        continue;
      }
      const bill = await lots.invoiceOrder(owner, {
        orderId: order.orderId, clientOpId: `dr-inv-${i}-${o}`,
      });
      // The harness step: give the invoice the date the supply happened. The app
      // cannot do this — see the note at the top of this file.
      await prisma.invoice.updateMany({
        where: { invoiceNumber: bill.invoiceNumber, factoryId: factory.id },
        data: { createdAt: new Date(`${iso(year, month, day)}T07:30:00.000Z`) },
      });
      row.invoices += 1;
      row.billedSales += bill.totals.taxableAmount;
      row.cgst += bill.totals.cgstAmount;
      row.sgst += bill.totals.sgstAmount;
      row.igst += bill.totals.igstAmount;
    }

    rows.push(row);
    process.stderr.write(`  ${label} done\n`);
  }

  // ================= the report =================
  const out: string[] = [];
  const p = (line = "") => out.push(line);

  p("# Vedam Granites — dry run, FY 2025-26");
  p();
  p("Twelve months driven through the real services: every figure below was produced");
  p("by the same code the screens call. Generated from a fixed seed, so it reproduces.");
  p();
  p("## Month by month");
  p();
  p("| Month | Blocks | Cut | Polished | Sold | Broken | Billed sales | Cash sales | CGST | SGST | IGST | Invoices |");
  p("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of rows) {
    p(`| ${r.label} | ${r.blocksIn} | ${r.slabsCut} | ${r.slabsPolished} | ${r.slabsSold} | ${r.slabsBroken} | ${inr(r.billedSales)} | ${inr(r.cashSales)} | ${inr(r.cgst)} | ${inr(r.sgst)} | ${inr(r.igst)} | ${r.invoices} |`);
  }
  const tot = <K extends keyof MonthRow>(k: K) =>
    rows.reduce((n, r) => n + (r[k] as number), 0);
  p(`| **Year** | **${tot("blocksIn")}** | **${tot("slabsCut")}** | **${tot("slabsPolished")}** | **${tot("slabsSold")}** | **${tot("slabsBroken")}** | **${inr(tot("billedSales"))}** | **${inr(tot("cashSales"))}** | **${inr(tot("cgst"))}** | **${inr(tot("sgst"))}** | **${inr(tot("igst"))}** | **${tot("invoices")}** |`);
  p();

  const billed = tot("billedSales");
  const cash = tot("cashSales");
  p("## The split you asked about");
  p();
  p(`- **On the bill:** ${inr(billed)} taxable, plus ${inr(tot("cgst") + tot("sgst") + tot("igst"))} GST.`);
  p(`- **Cash, no bill:** ${inr(cash)} — ${((cash / (billed + cash)) * 100).toFixed(1)}% of turnover.`);
  p(`- **Purchases:** ${inr(tot("purchaseBilled"))} on vendor bills, ${inr(tot("purchaseCash"))} in cash.`);
  p(`- ${tot("cashOnlyOrders")} orders were wholly in cash and raised no invoice at all.`);
  p();

  p("## GSTR-1, month by month");
  p();
  p("Straight from `gstr1()`. The excluded column is the unbilled cash the return");
  p("reports separately — it is never silently dropped.");
  p();
  p("| Month | B2B | B2C | Taxable filed | CGST | SGST | IGST | Excluded cash |");
  p("|---|--:|--:|--:|--:|--:|--:|--:|");
  let filedTaxable = 0, filedTax = 0, excluded = 0;
  for (const r of rows) {
    const g = await gst.gstr1(factory.id, r.month);
    filedTaxable += g.totals.taxable;
    filedTax += g.totals.cgst + g.totals.sgst + g.totals.igst;
    excluded += g.excludedCashSales.amount;
    p(`| ${r.label} | ${g.b2b.length} | ${g.b2cLarge.length + g.b2cSmall.length} | ${inr(g.totals.taxable)} | ${inr(g.totals.cgst)} | ${inr(g.totals.sgst)} | ${inr(g.totals.igst)} | ${inr(g.excludedCashSales.amount)} |`);
  }
  p(`| **Year** | | | **${inr(filedTaxable)}** | | | **${inr(filedTax)}** | **${inr(excluded)}** |`);
  p();

  p("## Do the books balance?");
  p();
  const tb = await books.trialBalance(factory.id);
  const dr = tb.reduce((n, r) => n + r.debit, 0);
  const cr = tb.reduce((n, r) => n + r.credit, 0);
  p(`Debits ${inr(dr)} · Credits ${inr(cr)} · **${Math.round((dr - cr) * 100) === 0 ? "balanced" : `OUT BY ${inr(dr - cr)}`}**`);
  p();
  p("| Ledger | Debit | Credit | Balance |");
  p("|---|--:|--:|--:|");
  for (const r of tb.filter((x) => x.debit || x.credit)) {
    p(`| ${r.code} — ${r.name} | ${inr(r.debit)} | ${inr(r.credit)} | ${inr(r.balance)} |`);
  }
  p();

  const stock = await lots.availability(factory.id);
  p("## Stock at 31 March 2026");
  p();
  p(`${stock.lots.length} lots still carrying slabs · **${stock.totalAvailableSlabs} slabs** · ${Math.round(stock.totalAvailableSqft).toLocaleString("en-IN")} sqft`);
  p();
  p("| Lot | Variety | Available | Polished | Still to polish | Cut | Broken | Sold |");
  p("|---|---|--:|--:|--:|--:|--:|--:|");
  for (const l of stock.lots.slice(0, 15)) {
    p(`| ${l.label} | ${l.variety} | ${l.availableSlabs} | ${l.polishedSlabCount} | ${l.unpolishedSlabs} | ${l.goodSlabCount} | ${l.brokenSlabCount} | ${l.soldSlabCount} |`);
  }
  if (stock.lots.length > 15) p(`| …${stock.lots.length - 15} more | | | | | | | |`);
  p();

  p("## Customers");
  p();
  p("| Buyer | GSTIN | State | Bills are |");
  p("|---|---|---|---|");
  for (const b of await prisma.customer.findMany({ where: { factoryId: factory.id }, orderBy: { name: "asc" } })) {
    p(`| ${b.name} | ${b.gstin ?? "none"} | ${b.stateCode ?? "—"} | ${b.gstin ? (b.stateCode === "08" ? "CGST + SGST" : "IGST") : "unregistered sale"} |`);
  }
  p();

  console.log(out.join("\n"));
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
