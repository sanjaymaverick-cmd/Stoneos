import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { gstSplitInclusive, rupeesToMinor } from "../books/money";

function mockIrn(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 16).toUpperCase();
  return `MOCK-IRN-${hex}`;
}

function hasLiveSecrets() {
  return Boolean(process.env.STONEOS_GST_IRP_USER && process.env.STONEOS_GST_IRP_SECRET);
}

@Injectable()
export class GstService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  profile(factoryId: string) {
    return this.prisma.gstProfile.findUnique({ where: { factoryId } });
  }

  upsertProfile(
    user: AuthenticatedUser,
    input: { gstin: string; legalName: string; stateCode: string; irpSandbox?: boolean },
  ) {
    if (!input.gstin.trim()) throw new BadRequestException("GSTIN is required");
    return this.prisma.gstProfile.upsert({
      where: { factoryId: user.factoryId },
      update: { gstin: input.gstin, legalName: input.legalName, stateCode: input.stateCode, irpSandbox: input.irpSandbox ?? true },
      create: {
        factoryId: user.factoryId,
        gstin: input.gstin,
        legalName: input.legalName,
        stateCode: input.stateCode,
        irpSandbox: input.irpSandbox ?? true,
      },
    });
  }

  async einvoice(user: AuthenticatedUser, invoiceId: string) {
    const profile = await this.profile(user.factoryId);
    if (!profile?.gstin) throw new BadRequestException("GSTIN missing on factory profile");
    const existing = await this.prisma.eInvoice.findUnique({ where: { invoiceId } });
    if (existing) return existing;
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, factoryId: user.factoryId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    const gross = rupeesToMinor(Number(invoice.amount));
    const split = gstSplitInclusive(gross);
    const source = hasLiveSecrets() ? "live" : "mock";
    const irn = source === "mock" ? mockIrn(invoice.invoiceNumber) : mockIrn(`live:${invoice.invoiceNumber}`);
    const payload = {
      Version: "1.1",
      Irn: irn,
      DocDtls: { Typ: "INV", No: invoice.invoiceNumber, Dt: invoice.createdAt.toISOString().slice(0, 10) },
      ValDtls: { AssVal: split.net / 100, IgstVal: split.gst / 100, TotInvVal: Number(invoice.amount) },
      SellerDtls: { Gstin: profile.gstin, LglNm: profile.legalName, Stcd: profile.stateCode },
    };
    return this.prisma.eInvoice.create({
      data: {
        factoryId: user.factoryId,
        invoiceId: invoice.id,
        irn,
        ackNo: `ACK-${invoice.invoiceNumber}`,
        signedQr: irn,
        status: source === "mock" ? "mock" : "live",
        source,
        payload,
      },
    });
  }

  async einvoiceCreditNote(user: AuthenticatedUser, creditNoteId: string) {
    const profile = await this.profile(user.factoryId);
    if (!profile?.gstin) throw new BadRequestException("GSTIN missing on factory profile");
    const existing = await this.prisma.eInvoice.findUnique({ where: { creditNoteId } });
    if (existing) return existing;
    const cn = await this.prisma.creditNote.findFirst({
      where: { id: creditNoteId, factoryId: user.factoryId },
    });
    if (!cn) throw new NotFoundException("Credit note not found");
    const irn = mockIrn(cn.creditNoteNumber);
    return this.prisma.eInvoice.create({
      data: {
        factoryId: user.factoryId,
        creditNoteId: cn.id,
        irn,
        ackNo: `ACK-${cn.creditNoteNumber}`,
        signedQr: irn,
        status: "mock",
        source: "mock",
        payload: { Typ: "CRN", No: cn.creditNoteNumber, Irn: irn, TotInvVal: Number(cn.amount) },
      },
    });
  }

  async eway(
    user: AuthenticatedUser,
    input: {
      clientOpId: string;
      invoiceId?: string;
      deliveryId?: string;
      vehicleId?: string;
      distanceKm?: number;
      fromGstin?: string;
      toGstin?: string;
      fromPin?: string;
      toPin?: string;
    },
  ) {
    const existing = await this.prisma.eWayBill.findUnique({
      where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId } },
    });
    if (existing) return existing;
    const source = process.env.STONEOS_GST_EWY_USER && process.env.STONEOS_GST_EWY_SECRET ? "live" : "mock";
    const ewbNo = source === "mock" ? `MOCK-EWB-${input.clientOpId.slice(0, 8).toUpperCase()}` : `EWB-${Date.now()}`;
    return this.prisma.eWayBill.create({
      data: {
        factoryId: user.factoryId,
        invoiceId: input.invoiceId,
        deliveryId: input.deliveryId,
        vehicleId: input.vehicleId,
        ewbNo,
        distanceKm: input.distanceKm ?? 0,
        fromGstin: input.fromGstin,
        toGstin: input.toGstin,
        fromPin: input.fromPin,
        toPin: input.toPin,
        status: source === "mock" ? "mock" : "live",
        source,
        clientOpId: input.clientOpId,
      },
    });
  }

  listEway(factoryId: string) {
    return this.prisma.eWayBill.findMany({ where: { factoryId }, orderBy: { createdAt: "desc" } });
  }

  listEinvoice(factoryId: string) {
    return this.prisma.eInvoice.findMany({ where: { factoryId }, orderBy: { createdAt: "desc" } });
  }

  async gstr1(factoryId: string, month: string) {
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new BadRequestException("month must be YYYY-MM");
    const start = new Date(`${month}-01T01:30:00Z`);
    const endMonth = Number(m[2]) === 12 ? 1 : Number(m[2]) + 1;
    const endYear = Number(m[2]) === 12 ? Number(m[1]) + 1 : Number(m[1]);
    const end = new Date(`${endYear}-${String(endMonth).padStart(2, "0")}-01T01:30:00Z`);
    const invoices = await this.prisma.invoice.findMany({
      where: { factoryId, createdAt: { gte: start, lt: end } },
      include: { customer: true, eInvoice: true },
    });
    const notes = await this.prisma.creditNote.findMany({
      where: { factoryId, createdAt: { gte: start, lt: end } },
      include: { eInvoice: true },
    });
    const b2b = invoices.map((inv) => {
      const gross = rupeesToMinor(Number(inv.amount));
      const split = gstSplitInclusive(gross);
      return {
        doc: inv.invoiceNumber,
        party: inv.customer.name,
        taxable: split.net / 100,
        gst: split.gst / 100,
        total: Number(inv.amount),
        irn: inv.eInvoice?.irn,
      };
    });
    const cn = notes.map((n) => {
      const gross = rupeesToMinor(Number(n.amount));
      const split = gstSplitInclusive(gross);
      return {
        doc: n.creditNoteNumber,
        taxable: split.net / 100,
        gst: split.gst / 100,
        total: Number(n.amount),
        irn: n.eInvoice?.irn,
      };
    });
    const csv = [
      "type,number,taxable,gst,total,irn",
      ...b2b.map((r) => `INV,${r.doc},${r.taxable},${r.gst},${r.total},${r.irn ?? ""}`),
      ...cn.map((r) => `CN,${r.doc},${r.taxable},${r.gst},${r.total},${r.irn ?? ""}`),
    ].join("\n");
    return { month, b2b, creditNotes: cn, csv };
  }
}
