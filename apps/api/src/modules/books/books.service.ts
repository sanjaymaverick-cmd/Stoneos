import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { bankLedgerForMethod, ensureChart, expenseLedgerForCategory } from "./chart";
import { ensureParty, postVoucher, type PostLine } from "./posting";
import { gstSplitInclusive, minorToRupees, rupeesToMinor } from "./money";
import { operationalDateFor } from "@stoneos/domain";

@Injectable()
export class BooksService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async ensureFactoryChart(factoryId: string) {
    await this.prisma.$transaction((tx) => ensureChart(tx, factoryId));
  }

  async postInvoice(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: { invoiceId: string; customerName: string; amount: number; clientOpId: string },
  ) {
    const party = await ensureParty(tx, user.factoryId, input.customerName, "customer");
    const minor = rupeesToMinor(input.amount);
    const { net, gst } = gstSplitInclusive(minor);
    const lines: PostLine[] = [
      { ledgerCode: "AR", debit: minor, credit: 0, partyId: party.id },
      { ledgerCode: "SALES", debit: 0, credit: net },
    ];
    if (gst > 0) lines.push({ ledgerCode: "GST_OUTPUT", debit: 0, credit: gst });
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "sales",
      source: "sales_invoice",
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
      memo: `Collection ${input.method}`,
      lines: [
        { ledgerCode: bank, debit: minor, credit: 0 },
        { ledgerCode: "AR", debit: 0, credit: minor, partyId: party.id },
      ],
    });
  }

  async postCreditNote(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: { creditNoteId: string; invoiceId: string; customerName: string; amount: number; clientOpId: string },
  ) {
    const party = await ensureParty(tx, user.factoryId, input.customerName, "customer");
    const minor = rupeesToMinor(input.amount);
    const { net, gst } = gstSplitInclusive(minor);
    const lines: PostLine[] = [
      { ledgerCode: "SALES", debit: net, credit: 0 },
      { ledgerCode: "AR", debit: 0, credit: minor, partyId: party.id },
    ];
    if (gst > 0) lines.unshift({ ledgerCode: "GST_OUTPUT", debit: gst, credit: 0 });
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

  async postSisterPurchase(
    tx: Prisma.TransactionClient,
    input: { buyerFactoryId: string; actorId: string; invoiceId: string; partyName: string; amount: number; clientOpId: string },
  ) {
    const party = await ensureParty(tx, input.buyerFactoryId, input.partyName, "supplier");
    const minor = rupeesToMinor(input.amount);
    return postVoucher(tx, {
      factoryId: input.buyerFactoryId,
      type: "journal",
      source: "interfactory_invoice",
      clientOpId: input.clientOpId,
      createdBy: input.actorId,
      sourceId: input.invoiceId,
      partyId: party.id,
      invoiceId: input.invoiceId,
      memo: `Sister purchase ${input.partyName}`,
      lines: [
        { ledgerCode: "STOCK", debit: minor, credit: 0 },
        { ledgerCode: "AP", debit: 0, credit: minor, partyId: party.id },
      ],
    });
  }

  async postSisterSettlement(
    tx: Prisma.TransactionClient,
    input: {
      buyerFactoryId: string;
      actorId: string;
      amount: number;
      method: string;
      clientOpId: string;
      partyName: string;
      paidAt?: Date;
    },
  ) {
    const party = await ensureParty(tx, input.buyerFactoryId, input.partyName, "supplier");
    const minor = rupeesToMinor(input.amount);
    const bank = bankLedgerForMethod(input.method);
    return postVoucher(tx, {
      factoryId: input.buyerFactoryId,
      type: "payment",
      source: "interfactory_settle",
      clientOpId: input.clientOpId,
      createdBy: input.actorId,
      operationalDate: input.paidAt,
      partyId: party.id,
      memo: `Sister settlement ${input.partyName}`,
      lines: [
        { ledgerCode: "AP", debit: minor, credit: 0, partyId: party.id },
        { ledgerCode: bank, debit: 0, credit: minor },
      ],
    });
  }

  async postLabourPay(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: { amountMinor: number; method: string; clientOpId: string; memo: string; date?: Date },
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
    input: { expenseId: string; category: string; amount: number; clientOpId: string; method?: string; date?: Date },
  ) {
    const minor = rupeesToMinor(input.amount);
    const exp = expenseLedgerForCategory(input.category);
    const bank = bankLedgerForMethod(input.method ?? "cash");
    return postVoucher(tx, {
      factoryId: user.factoryId,
      type: "payment",
      source: "expense_create",
      clientOpId: input.clientOpId,
      createdBy: user.id,
      operationalDate: input.date,
      sourceId: input.expenseId,
      memo: input.category,
      lines: [
        { ledgerCode: exp, debit: minor, credit: 0 },
        { ledgerCode: bank, debit: 0, credit: minor },
      ],
    });
  }

  async parties(factoryId: string) {
    const parties = await this.prisma.party.findMany({
      where: { factoryId },
      orderBy: { name: "asc" },
    });
    const lines = await this.prisma.voucherLine.findMany({
      where: { partyId: { in: parties.map((p) => p.id) } },
      include: { ledger: true },
    });
    return parties.map((p) => {
      const mine = lines.filter((l) => l.partyId === p.id);
      const ar = mine.filter((l) => l.ledger.code === "AR").reduce((s, l) => s + l.debit - l.credit, 0);
      const ap = mine.filter((l) => l.ledger.code === "AP").reduce((s, l) => s + l.credit - l.debit, 0);
      return {
        ...p,
        outstandingAr: minorToRupees(ar),
        outstandingAp: minorToRupees(ap),
        youllGet: minorToRupees(Math.max(0, ar)),
        youllGive: minorToRupees(Math.max(0, ap)),
      };
    });
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
