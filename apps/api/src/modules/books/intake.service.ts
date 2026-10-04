import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { FilesService } from "../files/files.service";
import { ExpensesService } from "../expenses/expenses.service";
import { ProductionService } from "../production/production.service";
import { SalesService } from "../sales/sales.service";
import { BooksService } from "./books.service";
import type { PostLine } from "./posting";
import type { AuthenticatedUser } from "../../common/current-user";
import {
  EXPENSE_DATA_ROLES,
  JOURNAL_POST_ROLES,
  PAYMENT_ROLES,
  PRODUCTION_INPUT_ROLES,
  canAccess,
  type Role,
} from "@stoneos/contracts";
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
    @Inject(BooksService) private books: BooksService,
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

  /**
   * What this draft will actually do, and whether the confirmer may do it.
   *
   * Derived from the same role sets that gate the direct routes, so the two cannot
   * drift: if `POST /invoices/:id/payments` needs {@link PAYMENT_ROLES}, then so does
   * confirming a rokad that contains a cash-in row.
   */
  private assertMayPost(
    user: AuthenticatedUser,
    kind: string,
    header: string[],
    rows: string[][],
  ) {
    const required: Array<{ what: string; roles: Role[] }> = [];

    if (kind === "rokad") {
      const iIn = header.indexOf("in");
      const iOut = header.indexOf("out");
      const amount = (row: string[], index: number) => (index >= 0 ? Number(row[index] ?? 0) : 0);
      if (rows.some((row) => amount(row, iOut) > 0)) {
        required.push({ what: "book an expense", roles: EXPENSE_DATA_ROLES });
      }
      if (rows.some((row) => amount(row, iIn) > 0)) {
        required.push({ what: "record a customer payment", roles: PAYMENT_ROLES });
      }
    }
    if (kind === "journal") {
      required.push({ what: "post a journal", roles: JOURNAL_POST_ROLES });
    }
    if (kind === "dpr") {
      required.push({ what: "complete a cutting session", roles: PRODUCTION_INPUT_ROLES });
    }

    for (const { what, roles } of required) {
      if (!canAccess(user.role as Role, roles)) {
        throw new ForbiddenException(
          `This ${kind} would ${what}, which a ${user.role} cannot do. Someone who can must confirm it.`,
        );
      }
    }
  }

  async confirm(user: AuthenticatedUser, draftId: string) {
    const draft = await this.prisma.intakeDraft.findFirst({
      where: { id: draftId, factoryId: user.factoryId },
    });
    if (!draft) throw new NotFoundException("Draft not found");
    if (['supplier_bill','delivery_note'].includes(draft.kind)) throw new BadRequestException('Review this document in Business insights; enter transactions manually');
    if (draft.status !== "proposed") throw new BadRequestException("Draft is not proposed");
    if (draft.proposedBy === user.id) {
      throw new ForbiddenException("The person who proposed the intake cannot confirm it");
    }
    const parsed = draft.parsed as { header?: string[]; rows?: string[][] };
    const header = parsed.header ?? [];
    const rows = parsed.rows ?? [];
    const mismatch: Prisma.InputJsonValue[] = [];

    // Confirming is not a clerical act: it posts payments, expenses, journals and
    // production. Being allowed to handle a draft never granted the right to post
    // its contents, so an operator — who may legitimately propose a rokad — could
    // settle a customer's invoice and book factory spend through this one call.
    // Checked here, before anything is written, so a refusal leaves no half-applied
    // file behind.
    this.assertMayPost(user, draft.kind, header, rows);

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

    if (draft.kind === "journal") {
      const journal = parsed as { lines?: PostLine[] };
      if (!journal.lines?.length) {
        mismatch.push({ reason: "journal has no lines" });
      } else {
        await this.prisma.$transaction((tx) =>
          this.books.postJournal(tx, user, {
            clientOpId: draft.clientOpId,
            memo: "Copilot journal",
            lines: journal.lines as PostLine[],
            date: draft.operationalDate,
          }),
        );
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
