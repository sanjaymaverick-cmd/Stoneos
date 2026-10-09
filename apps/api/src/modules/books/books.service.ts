import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { bankLedgerForMethod, ensureChart, expenseLedgerForCategory } from "./chart";
import { ensureParty, postVoucher, type PostLine } from "./posting";
import {
  minorToRupees,
  rupeesToMinor,
  partyNameKey,
  type GstBreakdown,
} from "./money";
import { operationalDateFor } from "@stoneos/domain";

@Injectable()
export class BooksService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async collectedPayments(factoryId: string, paidAt: Date) {
    const r = await this.prisma.payment.aggregate({
      where: { factoryId, paidAt },
      _sum: { amount: true },
    });
    const opening = await this.prisma.openingSettlement.aggregate({ where: { factoryId, paidAt, line: { kind: "DEBTOR" } }, _sum: { amount: true } });
    return Number(r._sum.amount ?? 0) + Number(opening._sum.amount ?? 0);
  }
  async collectedCash(factoryId: string, saleDate: Date) {
    const r = await this.prisma.cashSale.aggregate({
      where: { factoryId, saleDate },
      _sum: { amount: true },
    });
    return Number(r._sum.amount ?? 0);
  }

  async ensureFactoryChart(factoryId: string) {
    await this.prisma.$transaction((tx) => ensureChart(tx, factoryId));
  }

  async postInvoice(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      invoiceId: string;
      customerName: string;
      gst: GstBreakdown;
      /** Charges billed outside the taxable value. Owed by the customer, never taxed. */
      exemptMinor?: number;
      invoiceDate?: Date;
      clientOpId: string;
    },
  ) {
    const party = await ensureParty(tx, user.factoryId, input.customerName, "customer");
    const gst = input.gst;
    // AR is the full payable; sales is the taxable value; each tax head stands alone.
    const exempt = input.exemptMinor ?? 0;
    const lines: PostLine[] = [
      { ledgerCode: "AR", debit: gst.totalMinor + exempt, credit: 0, partyId: party.id },
      { ledgerCode: "SALES", debit: 0, credit: gst.taxableMinor + exempt },
    ];
    for (const [code, amount] of gstOutputLines(gst)) {
      lines.push({ ledgerCode: code, debit: 0, credit: amount });
    }
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "sales",
      source: "sales_invoice",
      operationalDate: input.invoiceDate,
      clientOpId: input.clientOpId,
      createdBy: user.id,
      sourceId: input.invoiceId,
      partyId: party.id,
      invoiceId: input.invoiceId,
      memo: `Invoice ${input.invoiceId}`,
      lines,
    });
  }

  async postPayment(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      note?: string | null;
      receivedBy?: string | null;
      reference?: string | null;
      paymentId: string;
      invoiceId: string;
      customerName: string;
      amount: number;
      method: string;
      clientOpId: string;
      paidAt?: Date;
    },
  ) {
    const party = await ensureParty(tx, user.factoryId, input.customerName, "customer");
    const minor = rupeesToMinor(input.amount);
    const bank = bankLedgerForMethod(input.method);
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "receipt",
      source: "sales_pay",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.paidAt,
      sourceId: input.paymentId,
      partyId: party.id,
      invoiceId: input.invoiceId,
      memo: [`Collection ${input.method}`, input.receivedBy ? `Received by: ${input.receivedBy}` : "", input.reference ? `Reference: ${input.reference}` : "", input.note].filter(Boolean).join(" · "),
      lines: [
        { ledgerCode: bank, debit: minor, credit: 0 },
        { ledgerCode: "AR", debit: 0, credit: minor, partyId: party.id },
      ],
    });
  }

  async postCreditNote(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      creditNoteId: string;
      invoiceId: string;
      customerName: string;
      gst: GstBreakdown;
      clientOpId: string;
    },
  ) {
    const party = await ensureParty(
      tx,
      user.factoryId,
      input.customerName,
      "customer",
    );
    const gst = input.gst;
    // A credit note reverses the original heads: tax comes back out of the same liability.
    const lines: PostLine[] = [
      { ledgerCode: "SALES", debit: gst.taxableMinor, credit: 0 },
      { ledgerCode: "AR", debit: 0, credit: gst.totalMinor, partyId: party.id },
    ];
    for (const [code, amount] of gstOutputLines(gst)) {
      lines.unshift({ ledgerCode: code, debit: amount, credit: 0 });
    }
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "credit_note",
      source: "sales_cn",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      sourceId: input.creditNoteId,
      partyId: party.id,
      invoiceId: input.invoiceId,
      memo: "Credit note",
      lines,
    });
  }

  /**
   * A raw-block purchase. Stock carries the value before tax, because the GST paid is
   * recoverable input credit rather than part of what the stone cost. The supplier is
   * owed the whole bill.
   */
  async postPurchase(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      rawBlockId: string;
      supplierName: string;
      gst: GstBreakdown;
      clientOpId: string;
      purchaseDate?: Date;
      memo?: string;
    },
  ) {
    const party = await ensureParty(tx, user.factoryId, input.supplierName, "supplier");
    const gst = input.gst;
    const lines: PostLine[] = [
      { ledgerCode: "STOCK", debit: gst.taxableMinor, credit: 0 },
      ...gstInputLines(gst).map(([ledgerCode, amount]) => ({ ledgerCode, debit: amount, credit: 0 })),
      { ledgerCode: "AP", debit: 0, credit: gst.totalMinor, partyId: party.id },
    ];
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "purchase",
      source: "block_purchase",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.purchaseDate,
      sourceId: input.rawBlockId,
      partyId: party.id,
      memo: input.memo ?? "Raw block purchase",
      lines,
    });
  }

  /**
   * The cash leg of a block purchase: paid outside the GST bill, so no input credit.
   *
   * An unregistered quarry supplier cannot charge tax, so there is none to reclaim —
   * the whole amount is cost of stone. Posted as its own voucher rather than folded
   * into the taxable leg so the two can always be told apart afterwards, and so a
   * block bought wholly in cash still produces a purchase entry.
   */
  async postCashPurchase(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      rawBlockId: string;
      amountMinor: number;
      clientOpId: string;
      memo: string;
      purchaseDate?: Date;
    },
  ) {
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "purchase",
      source: "block_purchase_cash",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.purchaseDate,
      sourceId: input.rawBlockId,
      memo: input.memo,
      lines: [
        { ledgerCode: "STOCK", debit: input.amountMinor, credit: 0 },
        { ledgerCode: "CASH", debit: 0, credit: input.amountMinor },
      ],
    });
  }

  /**
   * Correct the cash leg of a purchase already on the books.
   *
   * Blocks received before the yard screen asked for a cash amount carry none, so
   * their cost basis is the billed leg alone and every valuation off it is short.
   * This posts the difference, not the whole amount, so a block corrected twice is
   * not counted twice.
   *
   * A negative delta (the recorded cash was too high) reverses the same two heads
   * rather than posting a negative, because a ledger line is an amount and a side,
   * and a negative debit is neither.
   */
  async postCashPurchaseCorrection(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      rawBlockId: string;
      deltaMinor: number;
      clientOpId: string;
      memo: string;
      purchaseDate?: Date;
    },
  ) {
    const amount = Math.abs(input.deltaMinor);
    const increase = input.deltaMinor > 0;
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "purchase",
      source: "block_purchase_cash",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.purchaseDate,
      sourceId: input.rawBlockId,
      memo: input.memo,
      lines: increase
        ? [
            { ledgerCode: "STOCK", debit: amount, credit: 0 },
            { ledgerCode: "CASH", debit: 0, credit: amount },
          ]
        : [
            { ledgerCode: "CASH", debit: amount, credit: 0 },
            { ledgerCode: "STOCK", debit: 0, credit: amount },
          ],
    });
  }

  /**
   * A counter sale settled in cash against no invoice. Cash is real and so is the
   * stock that left, so both are booked; the revenue simply lands on its own ledger.
   */
  async postCashSale(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      cashSaleId: string;
      amountMinor: number;
      memo: string;
      clientOpId: string;
      saleDate?: Date;
    },
  ) {
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "receipt",
      source: "cash_sale",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.saleDate,
      sourceId: input.cashSaleId,
      memo: input.memo,
      lines: [
        { ledgerCode: "CASH", debit: input.amountMinor, credit: 0 },
        { ledgerCode: "SALES_UNBILLED", debit: 0, credit: input.amountMinor },
      ],
    });
  }

  async postLabourPay(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      amountMinor: number;
      method: string;
      clientOpId: string;
      memo: string;
      date?: Date;
    },
  ) {
    const bank = bankLedgerForMethod(input.method);
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "payment",
      source: "muster_pay",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.date,
      memo: input.memo,
      lines: [
        { ledgerCode: "EXP_LABOUR", debit: input.amountMinor, credit: 0 },
        { ledgerCode: bank, debit: 0, credit: input.amountMinor },
      ],
    });
  }

  async postJournal(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: { clientOpId: string; memo: string; lines: PostLine[]; date?: Date },
  ) {
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "journal",
      source: "copilot_journal",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.date,
      memo: input.memo,
      lines: input.lines,
    });
  }

  async postExpense(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: {
      expenseId: string;
      category: string;
      /** Total paid, tax included. */
      amount: number;
      /** Present when the spend carried creditable GST; absent means no credit claimed. */
      gst?: GstBreakdown;
      clientOpId: string;
      method?: string;
      date?: Date;
    },
  ) {
    const minor = rupeesToMinor(input.amount);
    const exp = expenseLedgerForCategory(input.category);
    const bank = bankLedgerForMethod(input.method ?? "cash");
    // The expense ledger carries the value before tax. Recoverable GST is an asset, not
    // a cost, so charging the whole bill to expense would overstate the cost of running
    // the plant by the credit.
    const gst = input.gst;
    const taxLines = gst ? gstInputLines(gst) : [];
    const taxMinor = taxLines.reduce((sum, [, amount]) => sum + amount, 0);

    // The supplier's bill total is the fact; the tax heads follow from the rate. The
    // expense ledger takes the remainder, so the voucher balances by construction.
    //
    // Deriving it matters: a real bill of Rs 18,000 at 18% has a taxable value of
    // Rs 15,254.237..., and whatever the accountant types for that will not multiply
    // back to exactly 18,000. Debiting their figure and crediting the bill left the
    // voucher a few paise apart, and every such expense was refused with "Voucher is
    // not balanced" — which named neither the cause nor the numbers. In a dry run at
    // factory volume this rejected all 104 expenses while reporting nothing wrong.
    const expenseMinor = minor - taxMinor;

    if (
      gst &&
      Math.abs(gst.taxableMinor - expenseMinor) >
        EXPENSE_ROUNDING_TOLERANCE_MINOR
    ) {
      // Beyond rounding, the two figures disagree about what was actually bought.
      // Absorbing that silently would bury a typo in the cost of running the plant.
      throw new BadRequestException(
        `Taxable value ${minorToRupees(gst.taxableMinor)} plus ${gst.ratePct}% GST ` +
          `(${minorToRupees(taxMinor)}) does not come to the bill total ` +
          `${minorToRupees(minor)}. Check the figures.`,
      );
    }

    const lines: PostLine[] = [
      { ledgerCode: exp, debit: expenseMinor, credit: 0 },
    ];
    for (const [ledgerCode, amount] of taxLines) {
      lines.push({ ledgerCode, debit: amount, credit: 0 });
    }
    lines.push({ ledgerCode: bank, debit: 0, credit: minor });
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "payment",
      source: "expense_create",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.date,
      sourceId: input.expenseId,
      memo: input.category,
      lines,
    });
  }

  async parties(factoryId: string) {
    const parties = await this.prisma.party.findMany({
      where: { factoryId },
      orderBy: { name: "asc" },
    });
    const lines = await this.prisma.voucherLine.findMany({
      where: { partyId: { in: parties.map((p) => p.id) } },
      include: { ledger: true, voucher: true },
    });
    const receipts = await this.prisma.rawBlock.findMany({
      where: { factoryId },
      include: { supplier: true },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { factoryId },
      include: { customer: true, payments: true, creditNotes: true },
    });
    const rows = parties.map((p) => {
      const mine = lines.filter((l) => l.partyId === p.id);
      const openingAr = mine
        .filter(
          (l) =>
            l.ledger.code === "AR" &&
            !["sales_invoice", "sales_pay", "sales_cn"].includes(
              l.voucher.source,
            ),
        )
        .reduce((s, l) => s + l.debit - l.credit, 0);
      const invoiceAr = invoices
        .filter((i) => partyNameKey(i.customer.name) === p.nameKey)
        .reduce(
          (s, i) =>
            s +
            Math.max(
              0,
              rupeesToMinor(Number(i.amount)) -
                i.payments.reduce(
                  (n, x) => n + rupeesToMinor(Number(x.amount)),
                  0,
                ) -
                i.creditNotes.reduce(
                  (n, x) => n + rupeesToMinor(Number(x.amount)),
                  0,
                ),
            ),
          0,
        );
      const ar = openingAr + invoiceAr;
      const ledgerAp = mine
        .filter((l) => l.ledger.code === "AP")
        .reduce((s, l) => s + l.credit - l.debit, 0);
      const purchases = receipts.filter(
        (r) =>
          partyNameKey(r.supplier?.name ?? "Unknown supplier") === p.nameKey,
      );
      const unposted = purchases
        .filter(
          (r) =>
            !mine.some(
              (l) =>
                l.voucher.source === "block_purchase" &&
                l.voucher.sourceId === r.id,
            ),
        )
        .reduce((s, r) => s + rupeesToMinor(Number(r.invoicedAmount ?? 0)), 0);
      const paid = purchases.reduce(
        (s, r) => s + rupeesToMinor(Number(r.actualAmountPaid ?? 0)),
        0,
      );
      const ap = ledgerAp + unposted - paid;
      return {
        ...p,
        outstandingAr: minorToRupees(ar),
        outstandingAp: minorToRupees(ap),
        youllGet: minorToRupees(Math.max(0, ar - ap)),
        youllGive: minorToRupees(Math.max(0, ap - ar)),
      };
    });
    // Old invoices may predate ledger posting: show their customer without creating data on a read.
    const missing = new Map<
      string,
      {
        id: string;
        name: string;
        kind: string;
        outstandingAr: number;
        outstandingAp: number;
        youllGet: number;
        youllGive: number;
      }
    >();
    for (const i of invoices) {
      if (parties.some((p) => p.nameKey === partyNameKey(i.customer.name)))
        continue;
      const amount = Math.max(
        0,
        Number(i.amount) -
          i.payments.reduce((n, p) => n + Number(p.amount), 0) -
          i.creditNotes.reduce((n, c) => n + Number(c.amount), 0),
      );
      const row = missing.get(i.customerId) ?? {
        id: i.customerId,
        name: i.customer.name,
        kind: "customer",
        outstandingAr: 0,
        outstandingAp: 0,
        youllGet: 0,
        youllGive: 0,
      };
      row.youllGet += amount;
      row.outstandingAr += amount;
      missing.set(i.customerId, row);
    }
    for (const r of receipts) {
      const name = r.supplier?.name ?? "Unknown supplier";
      if (parties.some((p) => p.nameKey === partyNameKey(name))) continue;
      const amount = Math.max(
        0,
        Number(r.invoicedAmount ?? 0) - Number(r.actualAmountPaid ?? 0),
      );
      if (!amount) continue;
      const key = r.supplierId ?? "unknown-supplier";
      const row = missing.get(key) ?? {
        id: key,
        name,
        kind: "supplier",
        outstandingAr: 0,
        outstandingAp: 0,
        youllGet: 0,
        youllGive: 0,
      };
      row.youllGive += amount;
      row.outstandingAp += amount;
      missing.set(key, row);
    }
    return [...rows, ...missing.values()];
  }

  async partyStatement(factoryId: string, partyId: string) {
    const party = await this.prisma.party.findFirst({ where: { id: partyId, factoryId } });
    if (!party) throw new NotFoundException("Party not found");
    const vouchers = await this.prisma.voucher.findMany({
      where: { factoryId, partyId },
      include: { lines: { include: { ledger: true } } },
      orderBy: [{ operationalDate: "asc" }, { createdAt: "asc" }],
    });
    const khata = await this.prisma.importedKhataLine.findMany({
      where: { partyId },
      orderBy: { lineDate: "asc" },
    });
    type Row = {
      date: string;
      details: string;
      debit: number;
      credit: number;
      balance: number;
      source: string;
      sort: number;
    };
    const unsorted: Row[] = [];
    for (const v of vouchers) {
      const debit = v.lines.filter((l) => l.partyId === party.id).reduce((s, l) => s + l.debit, 0);
      const credit = v.lines.filter((l) => l.partyId === party.id).reduce((s, l) => s + l.credit, 0);
      unsorted.push({
        date: v.operationalDate.toISOString().slice(0, 10),
        details: v.memo ?? v.type,
        debit: minorToRupees(debit),
        credit: minorToRupees(credit),
        balance: 0,
        source: v.source,
        sort: v.createdAt.getTime(),
      });
    }
    for (const line of khata) {
      unsorted.push({
        date: line.lineDate ? line.lineDate.toISOString().slice(0, 10) : "",
        details: line.details,
        debit: minorToRupees(line.debitMinor),
        credit: minorToRupees(line.creditMinor),
        balance: 0,
        source: "khata.line",
        sort: line.lineDate ? line.lineDate.getTime() : 0,
      });
    }
    unsorted.sort((a, b) => a.date.localeCompare(b.date) || a.sort - b.sort);
    let balance = 0;
    const rows = unsorted.map((row) => {
      balance += rupeesToMinor(row.debit) - rupeesToMinor(row.credit);
      return { date: row.date, details: row.details, debit: row.debit, credit: row.credit, balance: minorToRupees(balance), source: row.source };
    });
    return { party, rows, youllGet: minorToRupees(Math.max(0, balance)), youllGive: minorToRupees(Math.max(0, -balance)) };
  }

  async trialBalance(factoryId: string) {
    await this.ensureFactoryChart(factoryId);
    const ledgers = await this.prisma.ledger.findMany({
      where: { factoryId },
      include: { lines: true },
      orderBy: { code: "asc" },
    });
    return ledgers.map((l) => {
      const debit = l.lines.reduce((s, x) => s + x.debit, 0);
      const credit = l.lines.reduce((s, x) => s + x.credit, 0);
      return {
        code: l.code,
        name: l.name,
        group: l.group,
        debit: minorToRupees(debit),
        credit: minorToRupees(credit),
        balance: minorToRupees(debit - credit),
      };
    });
  }

  async outstanding(factoryId: string) {
    const rows = await this.parties(factoryId);
    const youllGet = rows.reduce((s, r) => s + r.youllGet, 0);
    const youllGive = rows.reduce((s, r) => s + r.youllGive, 0);
    return { youllGet, youllGive, net: youllGet - youllGive, parties: rows };
  }

  async rokad(factoryId: string, date: Date) {
    const day = operationalDateFor(date);
    const drawer = await this.prisma.cashDrawerDay.findUnique({
      where: { factoryId_operationalDate: { factoryId, operationalDate: day } },
    });
    const vouchers = await this.prisma.voucher.findMany({
      where: { factoryId, operationalDate: day },
      include: { lines: { include: { ledger: true } }, party: true },
      orderBy: { createdAt: "asc" },
    });
    const cash = vouchers.flatMap((v) =>
      v.lines
        .filter((l) => l.ledger.code === "CASH")
        .map((l) => ({
          voucherId: v.id,
          memo: v.memo,
          in: minorToRupees(l.debit),
          out: minorToRupees(l.credit),
          party: v.party?.name,
        })),
    );
    return { date: day.toISOString().slice(0, 10), drawer, cash };
  }

  async lockDrawer(user: AuthenticatedUser, date: Date, countedClose: number) {
    const day = operationalDateFor(date);
    return this.prisma.cashDrawerDay.upsert({
      where: { factoryId_operationalDate: { factoryId: user.factoryId, operationalDate: day } },
      update: {
        countedClose: rupeesToMinor(countedClose),
        confirmedBy: user.id,
        status: "locked",
      },
      create: {
        factoryId: user.factoryId,
        operationalDate: day,
        countedClose: rupeesToMinor(countedClose),
        confirmedBy: user.id,
        status: "locked",
      },
    });
  }
}

/** The tax heads actually charged, as ledger/amount pairs. Zero heads are never posted. */
function gstOutputLines(gst: GstBreakdown): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  if (gst.cgstMinor > 0) out.push(["GST_OUTPUT_CGST", gst.cgstMinor]);
  if (gst.sgstMinor > 0) out.push(["GST_OUTPUT_SGST", gst.sgstMinor]);
  if (gst.igstMinor > 0) out.push(["GST_OUTPUT_IGST", gst.igstMinor]);
  return out;
}

/** Input credit heads actually paid, as ledger/amount pairs. Zero heads are never posted. */
/**
 * How far the stated taxable value may sit from the bill total less tax before it is
 * treated as a mistake rather than rounding. One rupee: enough for an accountant who
 * types the taxable value in whole rupees, far too small to hide a wrong figure.
 */
const EXPENSE_ROUNDING_TOLERANCE_MINOR = 100;

function gstInputLines(gst: GstBreakdown): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  if (gst.cgstMinor > 0) out.push(["GST_INPUT_CGST", gst.cgstMinor]);
  if (gst.sgstMinor > 0) out.push(["GST_INPUT_SGST", gst.sgstMinor]);
  if (gst.igstMinor > 0) out.push(["GST_INPUT_IGST", gst.igstMinor]);
  return out;
}
