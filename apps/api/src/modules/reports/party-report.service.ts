import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { parseOperationalDate } from "@stoneos/domain";
import { buildWorkbook, text, dec, type Cell, type Sheet } from "@stoneos/xlsx";
import { PrismaService } from "../../common/prisma.service";
import { factoryToday, partyNameKey, rupeesToMinor } from "../books/money";

type Side = "customer" | "supplier";
export interface PartyEntry {
  id: string;
  partyId: string;
  name: string;
  side: Side;
  date: string;
  type: string;
  reference: string;
  details: string;
  debit: number;
  credit: number;
  paidIn: number;
  paidOut: number;
  mode: string;
}
export interface PartyChoice {
  id: string;
  name: string;
  side: Side;
  contact: string;
  gstin: string;
}
export interface PartyFilters {
  side?: string;
  partyId?: string;
  from?: string;
  to?: string;
  type?: string;
}
const money = (v: unknown) => rupeesToMinor(Number(v ?? 0));
const iso = (date: Date) => date.toISOString().slice(0, 10);
const createdDate = (date: Date) => factoryToday(date);
export function assemblePartyReport(
  parties: PartyChoice[],
  entries: PartyEntry[],
  filters: PartyFilters,
) {
  const from = filters.from ?? "";
  const to = filters.to || factoryToday();
  for (const value of [from, to].filter(Boolean)) {
    try {
      parseOperationalDate(value);
    } catch {
      throw new BadRequestException(
        "Report dates must be real YYYY-MM-DD dates",
      );
    }
  }
  if (from && from > to)
    throw new BadRequestException("Start date must not be after end date");
  if (filters.side && !["customer", "supplier"].includes(filters.side))
    throw new BadRequestException("Unknown party type");
  if (
    filters.type &&
    !["all", "sales", "purchases", "payments", "dues"].includes(filters.type)
  )
    throw new BadRequestException("Unknown report type");
  const selected = parties.filter(
    (p) =>
      (!filters.side || p.side === filters.side) &&
      (!filters.partyId || p.id === filters.partyId),
  );
  if (filters.partyId && !selected.length)
    throw new BadRequestException(
      "Party does not belong to this factory or party type",
    );
  const ids = new Set(selected.map((p) => p.id));
  const dated = entries
    .filter((e) => ids.has(e.partyId) && e.date <= to)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        [
          "Opening / adjustment",
          "Sale",
          "Purchase",
          "Credit note",
          "Payment received",
          "Payment made",
        ].indexOf(a.type) -
          [
            "Opening / adjustment",
            "Sale",
            "Purchase",
            "Credit note",
            "Payment received",
            "Payment made",
          ].indexOf(b.type) ||
        a.id.localeCompare(b.id),
    );
  const summary = selected
    .map((p) => {
      const mine = dated.filter((e) => e.partyId === p.id);
      const before = mine.filter((e) => from && e.date < from);
      const period = mine.filter((e) => !from || e.date >= from);
      const total = (
        rows: PartyEntry[],
        key: "debit" | "credit" | "paidIn" | "paidOut",
      ) => rows.reduce((n, e) => n + e[key], 0);
      const opening = total(before, "debit") - total(before, "credit");
      const closing =
        opening + total(period, "debit") - total(period, "credit");
      return {
        ...p,
        opening: opening / 100,
        charges: total(period, "debit") / 100,
        credits: total(period, "credit") / 100,
        received: total(period, "paidIn") / 100,
        paid: total(period, "paidOut") / 100,
        balance: closing / 100,
        due: Math.max(0, closing) / 100,
        advance: Math.max(0, -closing) / 100,
      };
    })
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
  const balances = new Map(
    summary.map((p) => [p.id, Math.round(p.opening * 100)]),
  );
  const rows = dated
    .filter((e) => !from || e.date >= from)
    .map((e) => {
      const balance = (balances.get(e.partyId) ?? 0) + e.debit - e.credit;
      balances.set(e.partyId, balance);
      return {
        ...e,
        debit: e.debit / 100,
        credit: e.credit / 100,
        paidIn: e.paidIn / 100,
        paidOut: e.paidOut / 100,
        balance: balance / 100,
      };
    })
    .filter(
      (e) =>
        !filters.type ||
        ["all", "dues"].includes(filters.type) ||
        (filters.type === "payments"
          ? e.type === "Payment received" || e.type === "Payment made"
          : filters.type === "sales"
            ? e.type === "Sale" || e.type === "Credit note"
            : e.type === "Purchase"),
    );
  return {
    from,
    to,
    parties,
    summary,
    rows,
    totals: {
      opening: summary.reduce((n, p) => n + p.opening, 0),
      charges: summary.reduce((n, p) => n + p.charges, 0),
      credits: summary.reduce((n, p) => n + p.credits, 0),
      received: summary.reduce((n, p) => n + p.received, 0),
      paid: summary.reduce((n, p) => n + p.paid, 0),
      due: summary.reduce((n, p) => n + p.due, 0),
      advance: summary.reduce((n, p) => n + p.advance, 0),
    },
    note: "Dues include opening balances and all entries through the end date. Historical purchase payment modes not captured are shown as Not recorded. Unbilled cash sales are included and labelled separately.",
  };
}
@Injectable()
export class PartyReportService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  async report(factoryId: string, filters: PartyFilters = {}) {
    const [
      customers,
      suppliers,
      invoices,
      blocks,
      cashSales,
      vouchers,
      finished,
    ] = await this.prisma.$transaction(
      [
        this.prisma.customer.findMany({ where: { factoryId } }),
        this.prisma.supplier.findMany({ where: { factoryId } }),
        this.prisma.invoice.findMany({
          where: { factoryId },
          include: {
            customer: true,
            payments: true,
            creditNotes: true,
            salesOrder: { include: { lines: true } },
          },
        }),
        this.prisma.rawBlock.findMany({
          where: { factoryId },
          include: { supplier: true },
        }),
        this.prisma.cashSale.findMany({
          where: { factoryId },
          include: { salesOrder: { include: { customer: true } } },
        }),
        this.prisma.voucher.findMany({
          where: { factoryId },
          include: {
            party: true,
            lines: { include: { ledger: true, party: true } },
          },
        }),
        this.prisma.finishedPurchase.findMany({
          where: { factoryId },
          include: { slabs: true },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const parties: PartyChoice[] = [
      ...customers.map((p) => ({
        id: "customer:" + p.id,
        name: p.name,
        side: "customer" as const,
        contact: p.contactInfo ?? "",
        gstin: p.gstin ?? "",
      })),
      ...suppliers.map((p) => ({
        id: "supplier:" + p.id,
        name: p.name,
        side: "supplier" as const,
        contact: p.contactInfo ?? "",
        gstin: p.gstin ?? "",
      })),
    ];
    const entries: PartyEntry[] = [];
    const add = (
      p: PartyChoice,
      id: string,
      date: string,
      type: string,
      reference: string,
      details: string,
      debit: number,
      credit = 0,
      mode = "",
      paidIn = 0,
      paidOut = 0,
    ) =>
      entries.push({
        id,
        partyId: p.id,
        name: p.name,
        side: p.side,
        date,
        type,
        reference,
        details,
        debit,
        credit,
        mode,
        paidIn,
        paidOut,
      });
    for (const i of invoices) {
      const p = parties.find((p) => p.id === "customer:" + i.customerId)!;
      add(
        p,
        i.id,
        iso(i.invoiceDate ?? new Date(createdDate(i.createdAt))),
        "Sale",
        i.invoiceNumber,
        i.salesOrder.lines
          .map(
            (l) =>
              (l.description ?? "Slabs") +
              " · " +
              Number(l.quantitySqft) +
              " sqft × " +
              Number(l.rate),
          )
          .join("; "),
        money(i.amount),
      );
      for (const pay of i.payments)
        add(
          p,
          pay.id,
          iso(pay.paidAt),
          "Payment received",
          i.invoiceNumber,
          ["Collection", pay.receivedBy ? `Received by: ${pay.receivedBy}` : "", pay.reference ? `Reference: ${pay.reference}` : "", pay.note].filter(Boolean).join(" · "),
          0,
          money(pay.amount),
          pay.method,
          money(pay.amount),
        );
      for (const c of i.creditNotes)
        add(
          p,
          c.id,
          createdDate(c.createdAt),
          "Credit note",
          c.creditNoteNumber,
          c.reason ?? "Return credit",
          0,
          money(c.amount),
        );
    }
    for (const b of blocks) {
      if (b.openingReference || b.tradeReference) continue;
      if (b.currentStatus === "reversed") continue;
      let p = parties.find((p) => p.id === "supplier:" + b.supplierId);
      if (!p) {
        p = {
          id: "supplier:unknown",
          name: "Unknown supplier",
          side: "supplier",
          contact: "",
          gstin: "",
        };
        if (!parties.some((x) => x.id === p!.id)) parties.push(p);
      }
      const date = b.purchaseDate
        ? iso(b.purchaseDate)
        : createdDate(b.createdAt);
      const billed = money(b.invoicedAmount),
        cash = money(b.purchaseCashAmount),
        paid = money(b.actualAmountPaid);
      add(
        p,
        b.id,
        date,
        "Purchase",
        b.supplierInvoiceNo ?? b.serialNumber,
        b.serialNumber +
          " · " +
          b.varietyName +
          " · " +
          Number(b.weightTons ?? 0) +
          " tonnes",
        billed + cash,
      );
      if (paid)
        add(
          p,
          b.id + ":paid",
          date,
          "Payment made",
          b.serialNumber,
          "Recorded at receipt",
          0,
          paid,
          b.purchasePaymentMethod ?? "Not recorded",
          0,
          paid,
        );
      if (cash)
        add(
          p,
          b.id + ":cash",
          date,
          "Payment made",
          b.serialNumber,
          "Cash outside purchase bill",
          0,
          cash,
          "cash",
          0,
          cash,
        );
    }

    for (const f of finished) {
      const date = iso(f.purchaseDate);
      const goods =
          money(f.goodsTaxable) + money(f.cgst) + money(f.sgst) + money(f.igst),
        freight =
          money(f.transportTaxable) +
          money(f.transportCgst) +
          money(f.transportSgst) +
          money(f.transportIgst);
      const goodsParty = parties.find(
        (p) => p.id === "supplier:" + f.supplierId,
      )!;
      const transportParty = parties.find(
        (p) => p.id === "supplier:" + (f.transportSupplierId ?? f.supplierId),
      )!;
      add(
        goodsParty,
        f.id,
        date,
        "Purchase",
        f.invoiceNo,
        f.reference +
          " · purchased " +
          f.kind +
          " · " +
          f.varietyName +
          " · " +
          f.slabs.length +
          " pieces",
        goods,
      );
      if (money(f.paidAmount))
        add(
          goodsParty,
          f.id + ":paid",
          date,
          "Payment made",
          f.invoiceNo,
          f.reference + " goods payment",
          0,
          money(f.paidAmount),
          f.paymentMethod,
          0,
          money(f.paidAmount),
        );
      if (freight)
        add(
          transportParty,
          f.id + ":transport",
          date,
          "Purchase",
          f.transportInvoiceNo ?? f.invoiceNo,
          f.reference + " · inward transport",
          freight,
        );
      if (money(f.transportPaidAmount))
        add(
          transportParty,
          f.id + ":transport-paid",
          date,
          "Payment made",
          f.transportInvoiceNo ?? f.invoiceNo,
          f.reference + " transport payment",
          0,
          money(f.transportPaidAmount),
          f.transportPaymentMethod,
          0,
          money(f.transportPaidAmount),
        );
    }
    for (const c of cashSales) {
      const p = parties.find(
        (p) => p.id === "customer:" + c.salesOrder.customerId,
      )!;
      add(
        p,
        c.id,
        iso(c.saleDate),
        "Sale",
        "Cash sale",
        c.note ?? "Unbilled cash sale",
        money(c.amount),
      );
      add(
        p,
        c.id + ":cash",
        iso(c.saleDate),
        "Payment received",
        "Cash sale",
        "Cash received",
        0,
        money(c.amount),
        "cash",
        money(c.amount),
      );
    }
    // Documents above are authoritative even if old rows lack vouchers. Supplement
    // them with opening balances and manual AR/AP postings, never their duplicate vouchers.
    for (const v of vouchers) {
      if (finished.some((f) => f.id === v.sourceId)) continue;
      if (
        [
          "sales_invoice",
          "sales_pay",
          "sales_cn",
          "cash_sale",
          "block_purchase",
          "block_purchase_cash",
        ].includes(v.source)
      )
        continue;
      for (const l of v.lines) {
        if (!l.party || !["AR", "AP"].includes(l.ledger.code)) continue;
        const side: Side = l.ledger.code === "AR" ? "customer" : "supplier";
        const candidates = parties.filter(
          (p) => p.side === side && partyNameKey(p.name) === l.party!.nameKey,
        );
        let p = candidates.length === 1 ? candidates[0] : undefined;
        if (!p) {
          p = {
            id: side + ":ledger:" + l.party.id,
            name: l.party.name,
            side,
            contact: l.party.phone ?? "",
            gstin: "",
          };
          if (!parties.some((x) => x.id === p!.id)) parties.push(p);
        }
        const delta =
          side === "customer" ? l.debit - l.credit : l.credit - l.debit;
        const bank = v.lines.filter((x) =>
          ["cash", "bank"].includes(x.ledger.kind),
        );
        const bankIn = bank.reduce((n, x) => n + x.debit, 0) > 0;
        const bankOut = bank.reduce((n, x) => n + x.credit, 0) > 0;
        const received = bankIn && v.type === "receipt" ? Math.abs(delta) : 0;
        const paid = bankOut && v.type === "payment" ? Math.abs(delta) : 0;
        const mode = bank.map((x) => x.ledger.name).join(", ");
        add(
          p,
          l.id,
          iso(v.operationalDate),
          received
            ? "Payment received"
            : paid
              ? "Payment made"
              : v.type === "sales" ? "Sale" : v.type === "purchase" ? "Purchase" : v.type === "receipt" ? "Payment received" : v.type === "payment" ? "Payment made" : "Opening / adjustment",
          v.id.slice(0, 8),
          v.memo ?? v.type,
          Math.max(0, delta),
          Math.max(0, -delta),
          mode,
          received,
          paid,
        );
      }
    }
    return assemblePartyReport(parties, entries, filters);
  }
  async workbook(factoryId: string, filters: PartyFilters) {
    const r = await this.report(factoryId, filters);
    const rows = (headers: string[], data: Cell[][], name: string): Sheet => ({
      name,
      freezeRows: 3,
      columnWidths: headers.map(() => 22),
      rows: [
        [text(name, true)],
        [text("Period: " + (r.from || "All dates") + " to " + r.to)],
        headers.map((h) => text(h, true)),
        ...data,
      ],
    });
    const summary = (side: Side) =>
      rows(
        [
          "Name",
          "Contact",
          "GSTIN",
          "Opening balance",
          "Charges",
          "Credits",
          "Received",
          "Paid",
          "Due",
          "Advance",
        ],
        r.summary
          .filter((p) => p.side === side)
          .map((p) => [
            text(p.name),
            text(p.contact),
            text(p.gstin),
            dec(p.opening),
            dec(p.charges),
            dec(p.credits),
            dec(p.received),
            dec(p.paid),
            dec(p.due),
            dec(p.advance),
          ]),
        side === "customer" ? "Customer dues" : "Supplier dues",
      );
    const detail = (name: string, selected: typeof r.rows) =>
      rows(
        [
          "Date",
          "Party",
          "Type",
          "Reference",
          "Details",
          "Charges",
          "Credits",
          "Received",
          "Paid",
          "Payment mode",
          "Running balance",
        ],
        selected.map((e) => [
          text(e.date),
          text(e.name),
          text(e.type),
          text(e.reference),
          text(e.details),
          dec(e.debit),
          dec(e.credit),
          dec(e.paidIn),
          dec(e.paidOut),
          text(e.mode),
          dec(e.balance),
        ]),
        name,
      );
    return {
      fileName: "party-report-" + r.to + ".xlsx",
      bytes: buildWorkbook([
        summary("customer"),
        summary("supplier"),
        detail("Transactions", r.rows),
        detail(
          "Payments",
          r.rows.filter((e) => e.paidIn || e.paidOut),
        ),
        { name: "Report notes", rows: [[text(r.note)]] },
      ]),
    };
  }
}
