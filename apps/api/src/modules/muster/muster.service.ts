import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MUSTER_PAY_ROLES, canAccess } from "@stoneos/contracts";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { BooksService } from "../books/books.service";
import { parseFactoryDate, partyNameKey, rupeesToMinor } from "../books/money";

@Injectable()
export class MusterService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(BooksService) private books: BooksService,
  ) {}

  workers(factoryId: string) {
    return this.prisma.worker.findMany({ where: { factoryId, active: true }, orderBy: { name: "asc" } });
  }

  createWorker(
    user: AuthenticatedUser,
    input: { name: string; kind?: "cutter" | "polisher" | "helper" | "driver" | "other"; dailyWage?: number },
  ) {
    return this.prisma.worker.create({
      data: {
        factoryId: user.factoryId,
        name: input.name.trim(),
        nameKey: partyNameKey(input.name),
        kind: input.kind ?? "other",
        dailyWageMinor: input.dailyWage == null ? undefined : rupeesToMinor(input.dailyWage),
      },
    });
  }

  attendance(factoryId: string, date: string) {
    const day = parseFactoryDate(date);
    return this.prisma.attendance.findMany({
      where: { factoryId, operationalDate: day },
      include: { worker: true },
    });
  }

  async mark(
    user: AuthenticatedUser,
    input: { workerId: string; date: string; status: "present" | "absent" | "half" | "ot"; otHours?: number },
  ) {
    const worker = await this.prisma.worker.findFirst({
      where: { id: input.workerId, factoryId: user.factoryId },
    });
    if (!worker) throw new NotFoundException("Worker not found");
    const day = parseFactoryDate(input.date);
    return this.prisma.attendance.upsert({
      where: { workerId_operationalDate: { workerId: worker.id, operationalDate: day } },
      update: { status: input.status, otHours: input.otHours },
      create: {
        factoryId: user.factoryId,
        workerId: worker.id,
        operationalDate: day,
        status: input.status,
        otHours: input.otHours,
      },
    });
  }

  sheets(factoryId: string) {
    return this.prisma.wageSheet.findMany({
      where: { factoryId },
      include: { lines: { include: { worker: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async draftSheet(
    user: AuthenticatedUser,
    input: { periodStart: string; periodEnd: string; clientOpId: string },
  ) {
    const existing = await this.prisma.wageSheet.findUnique({
      where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId } },
    });
    if (existing) return this.prisma.wageSheet.findUnique({ where: { id: existing.id }, include: { lines: true } });
    const start = parseFactoryDate(input.periodStart);
    const end = parseFactoryDate(input.periodEnd);
    const workers = await this.prisma.worker.findMany({
      where: { factoryId: user.factoryId, active: true },
      include: {
        attendance: { where: { operationalDate: { gte: start, lte: end } } },
      },
    });
    const lines = workers.map((w) => {
      const days = w.attendance.reduce((s, a) => {
        if (a.status === "present") return s + 1;
        if (a.status === "half") return s + 0.5;
        if (a.status === "ot") return s + 1;
        return s;
      }, 0);
      const ot = w.attendance.reduce((s, a) => s + Number(a.otHours ?? 0), 0);
      const wage = w.dailyWageMinor ?? 0;
      const amountMinor = Math.round(days * wage + ot * (wage / 8));
      return { workerId: w.id, days, ot, amountMinor };
    });
    return this.prisma.wageSheet.create({
      data: {
        factoryId: user.factoryId,
        periodStart: start,
        periodEnd: end,
        clientOpId: input.clientOpId,
        proposedBy: user.id,
        lines: { create: lines },
      },
      include: { lines: { include: { worker: true } } },
    });
  }

  async confirm(user: AuthenticatedUser, sheetId: string) {
    const sheet = await this.prisma.wageSheet.findFirst({
      where: { id: sheetId, factoryId: user.factoryId },
    });
    if (!sheet) throw new NotFoundException("Sheet not found");
    if (sheet.status !== "draft") throw new BadRequestException("Sheet is not a draft");
    if (sheet.proposedBy === user.id) {
      throw new ForbiddenException("The person who drafted the wage sheet cannot confirm it");
    }
    return this.prisma.wageSheet.update({
      where: { id: sheet.id },
      data: { status: "confirmed", confirmedBy: user.id },
    });
  }

  async pay(user: AuthenticatedUser, sheetId: string, method: string) {
    if (!canAccess(user.role, MUSTER_PAY_ROLES)) {
      throw new ForbiddenException("Insufficient role");
    }
    const sheet = await this.prisma.wageSheet.findFirst({
      where: { id: sheetId, factoryId: user.factoryId },
      include: { lines: true },
    });
    if (!sheet) throw new NotFoundException("Sheet not found");
    if (sheet.status === "paid") return sheet;
    if (sheet.status !== "confirmed") throw new BadRequestException("Confirm the sheet before paying");
    const amountMinor = sheet.lines.reduce((s, l) => s + l.amountMinor, 0);
    if (amountMinor <= 0) throw new BadRequestException("Wage sheet has no amount");
    return this.prisma.$transaction(async (tx) => {
      const voucher = await this.books.postLabourPay(tx, user, {
        amountMinor,
        method,
        clientOpId: sheet.clientOpId,
        memo: `Muster ${sheet.periodStart.toISOString().slice(0, 10)}-${sheet.periodEnd.toISOString().slice(0, 10)}`,
        date: sheet.periodEnd,
      });
      return tx.wageSheet.update({
        where: { id: sheet.id },
        data: { status: "paid", paidVoucherId: voucher.id },
      });
    });
  }
}
