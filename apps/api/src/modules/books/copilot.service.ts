import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { parseFactoryDate, shaClientOpId } from "./money";
import { assertVoucherLines, type PostLine } from "./posting";
import { previewKhata } from "./khata-pdf";

const SYSTEM_PROMPT = `You classify factory rokad/DPR/khata text into a draft only.
factoryId comes from the session. Never emit SQL. Never mint INV numbers from narration.
Never treat "Cash 97070" or "Vipul Cash 108162" as a payment. Do not confirm drafts.`;

export function ruleBasedDraft(text: string): { kind: "rokad" | "dpr" | "journal"; parsed: Record<string, unknown> } {
  const preview = previewKhata({ fileName: "copilot.txt", text });
  if (preview.kind === "customer-list") {
    return { kind: "journal", parsed: { parties: preview.parties, note: "khata list is import-only; not posted" } };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = (lines[0] ?? "").toLowerCase();
  if (header.includes("particulars") && (header.includes("in") || header.includes("out"))) {
    return { kind: "rokad", parsed: { header: header.split(","), rows: lines.slice(1).map((l) => l.split(",")) } };
  }
  if (header.includes("block") && header.includes("good")) {
    return { kind: "dpr", parsed: { header: header.split(","), rows: lines.slice(1).map((l) => l.split(",")) } };
  }
  const journalLines: PostLine[] = [];
  for (const line of lines) {
    const m = line.match(/^(AR|AP|CASH|SALES|EXP_\w+|GST_OUTPUT|STOCK)\s+(Dr|Cr)\s+([\d.]+)$/i);
    if (!m) continue;
    const amt = Math.round(Number(m[3]) * 100);
    journalLines.push({
      ledgerCode: m[1]!.toUpperCase(),
      debit: /dr/i.test(m[2] ?? "") ? amt : 0,
      credit: /cr/i.test(m[2] ?? "") ? amt : 0,
    });
  }
  if (journalLines.length) {
    assertVoucherLines(journalLines);
    return { kind: "journal", parsed: { lines: journalLines } };
  }
  throw new BadRequestException("Could not classify draft from text. Use rokad/dpr CSV or ledger Dr/Cr lines.");
}

@Injectable()
export class CopilotService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  async propose(user: AuthenticatedUser, input: { text: string; date?: string; clientOpId?: string }) {
    const classified = ruleBasedDraft(input.text);
    const day = parseFactoryDate(input.date ?? new Date().toISOString().slice(0, 10));
    const clientOpId =
      input.clientOpId ??
      shaClientOpId([user.factoryId, "copilot", classified.kind, createHash("sha256").update(input.text).digest("hex")]);
    const existing = await this.prisma.intakeDraft.findUnique({
      where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } },
    });
    if (existing) return existing;
    const draft = await this.prisma.intakeDraft.create({
      data: {
        factoryId: user.factoryId,
        kind: classified.kind,
        operationalDate: day,
        status: "proposed",
        clientOpId,
        parsed: classified.parsed as Prisma.InputJsonValue,
        proposedBy: user.id,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "books.copilot.propose",
      entityType: "intake_draft",
      entityId: draft.id,
      payload: { kind: classified.kind },
    });
    return draft;
  }
}

export { SYSTEM_PROMPT };
