import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { FilesService } from "../files/files.service";
import { ExpensesService } from "../expenses/expenses.service";
import { ProductionService } from "../production/production.service";
import { SalesService } from "../sales/sales.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { operationalDateFor } from "@stoneos/domain";
import { expenseCategoryFromParticulars } from "./chart";
import { partyNameKey, shaClientOpId } from "./money";

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
}

@Injectable()
export class IntakeService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FilesService) private files: FilesService,
    @Inject(ExpensesService) private expenses: ExpensesService,
    @Inject(SalesService) private sales: SalesService,
    @Inject(ProductionService) private production: ProductionService,
  ) {}

  list(factoryId: string) {
    return this.prisma.intakeDraft.findMany({
      where: { factoryId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async propose(
    user: AuthenticatedUser,
    input: { kind: "rokad" | "dpr"; date: string; fileName: string; contentType: string; base64: string },
  ) {
    const bytes = Buffer.from(input.base64, "base64");
    const text = bytes.toString("utf8");
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const stored = await this.files.upload(user, {
      fileName: input.fileName,
      contentType: input.contentType,
      base64: input.base64,
    });
    const day = operationalDateFor(new Date(`${input.date}T01:30:00Z`));
    const clientOpId = shaClientOpId([user.factoryId, input.kind, input.date, fileHash, "0"]);
    const existing = await this.prisma.intakeDraft.findUnique({
      where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } },
    });
    if (existing) return existing;

    const isCsv = /csv|text\/plain|sheet/i.test(input.contentType) || input.fileName.endsWith(".csv");
    if (!isCsv) {
      return this.prisma.intakeDraft.create({
        data: {
          factoryId: user.factoryId,
          kind: input.kind,
          operationalDate: day,
          status: "unreadable",
          clientOpId,
          sourceFileId: stored.id,
          parsed: { reason: "PDF/photo needs frozen CSV template" },
          proposedBy: user.id,
          error: "unreadable",
        },
      });
    }
    const rows = parseCsv(text);
    const header = (rows[0] ?? []).map((h) => h.toLowerCase());
    const body = rows.slice(1);
    return this.prisma.intakeDraft.create({
      data: {
        factoryId: user.factoryId,
        kind: input.kind,
        operationalDate: day,
        status: "proposed",
        clientOpId,
        sourceFileId: stored.id,
        parsed: { header, rows: body, fileHash },
        proposedBy: user.id,
      },
    });
  }

  async confirm(user: AuthenticatedUser, draftId: string) {
    const draft = await this.prisma.intakeDraft.findFirst({
      where: { id: draftId, factoryId: user.factoryId },
    });
    if (!draft) throw new NotFoundException("Draft not found");
    if (draft.status !== "proposed") throw new BadRequestException("Draft is not proposed");
    if (draft.proposedBy === user.id) {
      throw new ForbiddenException("The person who proposed the intake cannot confirm it");
    }
    const parsed = draft.parsed as { header?: string[]; rows?: string[][] };
    const header = parsed.header ?? [];
    const rows = parsed.rows ?? [];
    const mismatch: Prisma.InputJsonValue[] = [];

    if (draft.kind === "rokad") {
      const iDate = header.indexOf("date");
      const iPart = header.indexOf("particulars");
      const iIn = header.indexOf("in");
      const iOut = header.indexOf("out");
      const iMode = header.indexOf("mode");
      const iParty = header.indexOf("partyname") >= 0 ? header.indexOf("partyname") : header.indexOf("party");
      for (const row of rows) {
        const particulars = row[iPart] ?? "";
        const incoming = Number(row[iIn] ?? 0);
        const outgoing = Number(row[iOut] ?? 0);
        const mode = row[iMode] ?? "cash";
        const partyName = iParty >= 0 ? row[iParty] : "";
        if (outgoing > 0) {
          await this.expenses.create(user, {
            category: expenseCategoryFromParticulars(particulars),
            amount: outgoing,
            expenseDate: draft.operationalDate.toISOString().slice(0, 10),
            clientOpId: shaClientOpId([draft.clientOpId, "out", particulars, String(outgoing)]),
          });
        }
        if (incoming > 0 && partyName) {
          const party = await this.prisma.party.findFirst({
            where: { factoryId: user.factoryId, nameKey: partyNameKey(partyName) },
          });
          const invoice = party
            ? await this.prisma.invoice.findFirst({
                where: { factoryId: user.factoryId, customer: { name: party.name } },
                include: { payments: true, creditNotes: true, customer: true },
                orderBy: { createdAt: "desc" },
              })
            : null;
          if (invoice) {
            await this.sales.pay(user, invoice.id, {
              amount: incoming,
              method: mode,
              paidAt: draft.operationalDate.toISOString().slice(0, 10),
              clientOpId: shaClientOpId([draft.clientOpId, "in", partyName, String(incoming)]),
            });
          } else {
            mismatch.push({ row, reason: "unallocated cash in — no open invoice" });
          }
        }
      }
    }

    if (draft.kind === "dpr") {
      const iBlock = header.findIndex((h) => h.includes("block"));
      const iGood = header.findIndex((h) => h.includes("good"));
      const iDamaged = header.findIndex((h) => h.includes("damaged"));
      for (const row of rows) {
        const blockRef = row[iBlock] ?? "";
        const good = Number(row[iGood] ?? 0);
        const damaged = Number(row[iDamaged] ?? 0);
        const block = await this.prisma.rawBlock.findFirst({
          where: { factoryId: user.factoryId, serialNumber: blockRef },
        });
        if (!block) {
          mismatch.push({ row, reason: "block missing — no stock created" });
          continue;
        }
        const session = await this.prisma.cuttingSession.findFirst({
          where: { factoryId: user.factoryId, rawBlockId: block.id, status: "IN_PROGRESS" },
        });
        if (!session) {
          mismatch.push({ row, reason: "no in-progress cutting session" });
          continue;
        }
        await this.production.completeCutting(user, session.id, {
          totalSlabsCut: good + damaged,
          finalGoodSlabCount: good,
        });
        const dpr = await this.production.derivedDpr(
          user.factoryId,
          draft.operationalDate,
          draft.operationalDate,
        );
        if (dpr.slabsCut !== good) {
          mismatch.push({ row, derivedSlabsCut: dpr.slabsCut, fileGoodSlabs: good });
        }
      }
    }

    return this.prisma.intakeDraft.update({
      where: { id: draft.id },
      data: {
        status: mismatch.length ? "confirmed" : "confirmed",
        confirmedBy: user.id,
        mismatch: mismatch.length ? mismatch : Prisma.JsonNull,
      },
    });
  }

  async reject(user: AuthenticatedUser, draftId: string, reason: string) {
    const draft = await this.prisma.intakeDraft.findFirst({
      where: { id: draftId, factoryId: user.factoryId },
    });
    if (!draft) throw new NotFoundException("Draft not found");
    if (draft.proposedBy === user.id) {
      throw new ForbiddenException("The person who proposed the intake cannot reject it as confirmer path");
    }
    return this.prisma.intakeDraft.update({
      where: { id: draft.id },
      data: { status: "rejected", confirmedBy: user.id, error: reason },
    });
  }
}
