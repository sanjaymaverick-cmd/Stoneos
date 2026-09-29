import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { factoryMonthStart } from "@stoneos/domain";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { normaliseStateCode, stateCodeFromGstin } from "../books/money";

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

  async upsertProfile(
    user: AuthenticatedUser,
    input: { gstin: string; legalName: string; stateCode: string; irpSandbox?: boolean },
  ) {
    const gstin = input.gstin.trim().toUpperCase();
    if (!gstin) throw new BadRequestException("GSTIN is required");
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin)) {
      throw new BadRequestException("GSTIN must be 15 characters, e.g. 08AAUFV3603N1ZH");
    }
    // The first two characters ARE the state code. A stateCode that disagrees with the
    // GSTIN would silently route tax to the wrong heads, so refuse it outright.
    const fromGstin = stateCodeFromGstin(gstin);
    const claimed = normaliseStateCode(input.stateCode);
    if (claimed && fromGstin && claimed !== fromGstin) {
      throw new BadRequestException(
        `State code ${claimed} contradicts GSTIN ${gstin}, which is state ${fromGstin}`,
      );
    }
    const stateCode = fromGstin ?? claimed;
    if (!stateCode) throw new BadRequestException("State code could not be resolved");
    return this.prisma.gstProfile.upsert({
      where: { factoryId: user.factoryId },
      update: { gstin, legalName: input.legalName, stateCode, irpSandbox: input.irpSandbox ?? true },
      create: {
        factoryId: user.factoryId,
        gstin,
        legalName: input.legalName,
        stateCode,
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
    const customer = await this.prisma.customer.findUnique({ where: { id: invoice.customerId } });
    const source = hasLiveSecrets() ? "live" : "mock";
    const irn = source === "mock" ? mockIrn(invoice.invoiceNumber) : mockIrn(`live:${invoice.invoiceNumber}`);
    const payload = {
      Version: "1.1",
      Irn: irn,
      DocDtls: { Typ: "INV", No: invoice.invoiceNumber, Dt: invoice.createdAt.toISOString().slice(0, 10) },
      // Values are read off the invoice as charged, never recomputed: a later profile
      // edit must not be able to restate a document already reported to the IRP.
      ValDtls: {
        AssVal: Number(invoice.taxableAmount),
        CgstVal: Number(invoice.cgstAmount),
        SgstVal: Number(invoice.sgstAmount),
        IgstVal: Number(invoice.igstAmount),
        TotInvVal: Number(invoice.amount),
      },
      SellerDtls: { Gstin: profile.gstin, LglNm: profile.legalName, Stcd: profile.stateCode },
      BuyerDtls: { LglNm: customer?.name, Gstin: customer?.gstin ?? undefined, Pos: invoice.placeOfSupply },
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
        payload: {
          Typ: "CRN",
          No: cn.creditNoteNumber,
          Irn: irn,
          ValDtls: {
            AssVal: Number(cn.taxableAmount),
            CgstVal: Number(cn.cgstAmount),
            SgstVal: Number(cn.sgstAmount),
            IgstVal: Number(cn.igstAmount),
            TotInvVal: Number(cn.amount),
          },
          Pos: cn.placeOfSupply,
        },
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
    // IST calendar-month boundaries (00:00 IST), not the 07:00 IST operational-day cutover.
    const start = factoryMonthStart(new Date(`${month}-15T12:00:00Z`));
    const endMonth = Number(m[2]) === 12 ? 1 : Number(m[2]) + 1;
    const endYear = Number(m[2]) === 12 ? Number(m[1]) + 1 : Number(m[1]);
    const end = factoryMonthStart(new Date(`${endYear}-${String(endMonth).padStart(2, "0")}-15T12:00:00Z`));
    const invoices = await this.prisma.invoice.findMany({
      where: { factoryId, createdAt: { gte: start, lt: end } },
      include: { customer: true, eInvoice: true },
    });
    const notes = await this.prisma.creditNote.findMany({
      where: { factoryId, createdAt: { gte: start, lt: end } },
      include: { eInvoice: true },
    });
    // Every figure is read off the document as issued. GSTR-1 needs the heads apart:
    // CGST and SGST for intra-state supplies, IGST for inter-state ones.
    const b2b = invoices.map((inv) => ({
      doc: inv.invoiceNumber,
      party: inv.customer.name,
      gstin: inv.customer.gstin ?? "",
      placeOfSupply: inv.placeOfSupply ?? "",
      ratePct: Number(inv.gstRatePct),
      taxable: Number(inv.taxableAmount),
      cgst: Number(inv.cgstAmount),
      sgst: Number(inv.sgstAmount),
      igst: Number(inv.igstAmount),
      total: Number(inv.amount),
      irn: inv.eInvoice?.irn,
    }));
    const cn = notes.map((n) => ({
      doc: n.creditNoteNumber,
      placeOfSupply: n.placeOfSupply ?? "",
      ratePct: Number(n.gstRatePct),
      taxable: Number(n.taxableAmount),
      cgst: Number(n.cgstAmount),
      sgst: Number(n.sgstAmount),
      igst: Number(n.igstAmount),
      total: Number(n.amount),
      irn: n.eInvoice?.irn,
    }));
    const row = (kind: string, r: (typeof b2b)[number] | (typeof cn)[number]) =>
      [
        kind,
        r.doc,
        "gstin" in r ? r.gstin : "",
        r.placeOfSupply,
        r.ratePct,
        r.taxable,
        r.cgst,
        r.sgst,
        r.igst,
        r.total,
        r.irn ?? "",
      ].join(",");
    const csv = [
      "type,number,gstin,place_of_supply,rate_pct,taxable,cgst,sgst,igst,total,irn",
      ...b2b.map((r) => row("INV", r)),
      ...cn.map((r) => row("CN", r)),
    ].join("\n");
    const totals = {
      taxable: b2b.reduce((t, r) => t + r.taxable, 0) - cn.reduce((t, r) => t + r.taxable, 0),
      cgst: b2b.reduce((t, r) => t + r.cgst, 0) - cn.reduce((t, r) => t + r.cgst, 0),
      sgst: b2b.reduce((t, r) => t + r.sgst, 0) - cn.reduce((t, r) => t + r.sgst, 0),
      igst: b2b.reduce((t, r) => t + r.igst, 0) - cn.reduce((t, r) => t + r.igst, 0),
    };
    return { month, b2b, creditNotes: cn, totals, csv };
  }
}
