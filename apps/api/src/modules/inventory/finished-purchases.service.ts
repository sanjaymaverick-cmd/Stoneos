import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  INVENTORY_DATA_ROLES,
  type FinishedGoodsInput,
  type Role,
} from "@stoneos/contracts";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { assertAllowedRoles } from "../../common/session.guard";
import {
  isGstRateSlab,
  gstOnTaxable,
  minorToRupees,
  parseBusinessDate,
  rupeesToMinor,
  stateCodeFromGstin,
  type GstBreakdown,
} from "../books/money";
import { ensureParty, postVoucher } from "../books/posting";
import { bankLedgerForMethod } from "../books/chart";
@Injectable()
export class FinishedPurchasesService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  list(factoryId: string) {
    return this.prisma.finishedPurchase.findMany({
      where: { factoryId },
      include: {
        supplier: true,
        transportSupplier: true,
        slabs: { include: { location: true } },
      },
      orderBy: { purchaseDate: "desc" },
    });
  }
  async receive(user: AuthenticatedUser, input: FinishedGoodsInput) {
    assertAllowedRoles(INVENTORY_DATA_ROLES, user.role as Role);
    if (
      !input.supplierId ||
      !input.clientOpId ||
      !input.reference?.trim() ||
      !input.varietyName?.trim() ||
      !input.invoiceNo?.trim()
    )
      throw new BadRequestException(
        "Reference, variety, supplier bill number and operation ID are required",
      );
    if (
      !["slab", "countertop"].includes(input.kind) ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > 1000
    )
      throw new BadRequestException(
        "Use slabs or countertops and a count between 1 and 1000",
      );
    for (const k of ["lengthFt", "widthFt", "thicknessMm"] as const)
      if (
        !Number.isFinite(input[k]) ||
        input[k] <= 0 ||
        Math.round(input[k] * 100) / 100 !== input[k] ||
        input[k] > (k === "thicknessMm" ? 999.99 : 9999.99)
      )
        throw new BadRequestException(k + " must be positive");
    for (const k of [
      "goodsTaxable",
      "paidAmount",
      "transportTaxable",
      "transportPaidAmount",
    ] as const)
      if (
        !Number.isFinite(input[k]) ||
        input[k] < 0 ||
        Math.round(input[k] * 100) / 100 !== input[k]
      )
        throw new BadRequestException(
          k + " must be a nonnegative amount with two decimals",
        );
    if (input.goodsTaxable <= 0)
      throw new BadRequestException(
        "Record the finished goods purchase value before GST",
      );
    if (
      !isGstRateSlab(input.gstRatePct) ||
      !isGstRateSlab(input.transportGstRatePct)
    )
      throw new BadRequestException("Choose valid GST rates from the bill");
    if (
      !["cash", "bank", "upi"].includes(input.paymentMethod) ||
      !["cash", "bank", "upi"].includes(input.transportPaymentMethod)
    )
      throw new BadRequestException("Choose cash, bank or UPI payment modes");
    const date = parseBusinessDate(input.purchaseDate, "purchaseDate");
    return this.prisma.$transaction(
      async (tx) => {
        const prior = await tx.finishedPurchase.findUnique({
          where: {
            factoryId_clientOpId: {
              factoryId: user.factoryId,
              clientOpId: input.clientOpId,
            },
          },
          include: { slabs: true },
        });
        if (prior) return prior;
        const supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, factoryId: user.factoryId },
        });
        const transportSupplier = input.transportSupplierId
          ? await tx.supplier.findFirst({
              where: {
                id: input.transportSupplierId,
                factoryId: user.factoryId,
              },
            })
          : supplier;
        if (!supplier || !transportSupplier)
          throw new BadRequestException(
            "Supplier does not belong to this factory",
          );
        if (
          input.transportSupplierId &&
          input.transportTaxable > 0 &&
          !input.transportInvoiceNo?.trim()
        )
          throw new BadRequestException(
            "Separate transport bill number is required",
          );
        const profile = await tx.gstProfile.findUnique({
          where: { factoryId: user.factoryId },
        });
        const state = profile
          ? (stateCodeFromGstin(profile.gstin) ?? profile.stateCode)
          : null;
        const tax = (
          amount: number,
          rate: number,
          vendor: typeof supplier,
        ): GstBreakdown => {
          if (rate > 0 && amount > 0 && (!profile || !vendor.gstin))
            throw new BadRequestException(
              "Save your GST profile and the supplier GSTIN before recording charged GST",
            );
          return gstOnTaxable(rupeesToMinor(amount), {
            supplierStateCode:
              (vendor.gstin ? stateCodeFromGstin(vendor.gstin) : null) ??
              vendor.stateCode ??
              state,
            placeOfSupplyStateCode: state,
            ratePct: rate,
            registered: rate > 0 && amount > 0,
            defaultRatePct: 0,
          });
        };
        const goods = tax(input.goodsTaxable, input.gstRatePct, supplier),
          transport = tax(
            input.transportTaxable,
            input.transportGstRatePct,
            transportSupplier,
          );
        if (
          rupeesToMinor(input.paidAmount) > goods.totalMinor ||
          rupeesToMinor(input.transportPaidAmount) > transport.totalMinor
        )
          throw new BadRequestException(
            "Payment exceeds its bill total including GST",
          );
        const location = await tx.inventoryLocation.findFirst({
          where: {
            factoryId: user.factoryId,
            code: "FINISHED_STOCK",
            active: true,
          },
        });
        if (!location)
          throw new BadRequestException("Finished stock location is missing");
        const receipt = await tx.finishedPurchase.create({
          data: {
            supplierGstin: supplier.gstin,
            transportSupplierGstin: transportSupplier.gstin,
            factoryId: user.factoryId,
            reference: input.reference.trim(),
            kind: input.kind,
            varietyName: input.varietyName.trim(),
            supplierId: supplier.id,
            invoiceNo: input.invoiceNo.trim(),
            purchaseDate: date,
            goodsTaxable: input.goodsTaxable,
            gstRatePct: goods.ratePct,
            cgst: minorToRupees(goods.cgstMinor),
            sgst: minorToRupees(goods.sgstMinor),
            igst: minorToRupees(goods.igstMinor),
            paidAmount: input.paidAmount,
            paymentMethod: input.paymentMethod,
            transportTaxable: input.transportTaxable,
            transportGstRatePct: transport.ratePct,
            transportCgst: minorToRupees(transport.cgstMinor),
            transportSgst: minorToRupees(transport.sgstMinor),
            transportIgst: minorToRupees(transport.igstMinor),
            transportSupplierId: input.transportSupplierId,
            transportInvoiceNo: input.transportInvoiceNo?.trim(),
            transportPaidAmount: input.transportPaidAmount,
            transportPaymentMethod: input.transportPaymentMethod,
            clientOpId: input.clientOpId,
          },
        });
        const postBill = async (
          gst: GstBreakdown,
          vendor: typeof supplier,
          paid: number,
          method: string,
          suffix: string,
          bill: string,
        ) => {
          if (!gst.totalMinor) return;
          const party = await ensureParty(
            tx,
            user.factoryId,
            vendor.name,
            "supplier",
          );
          const taxLines = [
            ["GST_INPUT_CGST", gst.cgstMinor],
            ["GST_INPUT_SGST", gst.sgstMinor],
            ["GST_INPUT_IGST", gst.igstMinor],
          ] as const;
          await postVoucher(tx, {
            factoryId: user.factoryId,
            type: "purchase",
            source: "manual",
            sourceId: receipt.id,
            createdBy: user.id,
            operationalDate: date,
            clientOpId: input.clientOpId + ":" + suffix,
            partyId: party.id,
            memo: receipt.reference + " / " + bill + " / " + suffix,
            lines: [
              { ledgerCode: "STOCK", debit: gst.taxableMinor, credit: 0 },
              ...taxLines
                .filter(([, v]) => v > 0)
                .map(([ledgerCode, v]) => ({
                  ledgerCode,
                  debit: v,
                  credit: 0,
                })),
              {
                ledgerCode: "AP",
                debit: 0,
                credit: gst.totalMinor,
                partyId: party.id,
              },
            ],
          });
          if (paid > 0)
            await postVoucher(tx, {
              factoryId: user.factoryId,
              type: "payment",
              source: "manual",
              sourceId: receipt.id,
              createdBy: user.id,
              operationalDate: date,
              clientOpId: input.clientOpId + ":" + suffix + ":paid",
              partyId: party.id,
              memo: receipt.reference + " / " + suffix + " payment",
              lines: [
                {
                  ledgerCode: "AP",
                  debit: rupeesToMinor(paid),
                  credit: 0,
                  partyId: party.id,
                },
                {
                  ledgerCode: bankLedgerForMethod(method),
                  debit: 0,
                  credit: rupeesToMinor(paid),
                },
              ],
            });
        };
        await postBill(
          goods,
          supplier,
          input.paidAmount,
          input.paymentMethod,
          "goods",
          input.invoiceNo,
        );
        await postBill(
          transport,
          transportSupplier,
          input.transportPaidAmount,
          input.transportPaymentMethod,
          "transport",
          input.transportInvoiceNo ?? input.invoiceNo,
        );
        const net = goods.taxableMinor + transport.taxableMinor,
          each = Math.floor(net / input.count),
          extra = net % input.count;
        const slabs = await tx.slab.createManyAndReturn({
          data: Array.from({ length: input.count }, (_, i) => ({
            factoryId: user.factoryId,
            finishedPurchaseId: receipt.id,
            slabSerial:
              receipt.reference + "-" + String(i + 1).padStart(3, "0"),
            varietyName: receipt.varietyName,
            lengthFt: input.lengthFt,
            widthFt: input.widthFt,
            thicknessMm: input.thicknessMm,
            finish: input.finish?.trim() || "polished",
            locationId: location.id,
            purchaseCost: minorToRupees(each + (i < extra ? 1 : 0)),
            createdAt: date,
          })),
        });
        await tx.inventoryMovement.createMany({
          data: slabs.map((s) => ({
            factoryId: user.factoryId,
            movementType: "GOODS_RECEIPT",
            slabId: s.id,
            quantity: 1,
            idempotencyKey: input.clientOpId + ":" + s.slabSerial,
            actorId: user.id,
            notes: "Purchased " + input.kind + " · " + receipt.reference,
          })),
        });
        await tx.auditEvent.create({
          data: {
            factoryId: user.factoryId,
            actorId: user.id,
            action: "inventory.receive_finished",
            entityType: "finished_purchase",
            entityId: receipt.id,
            payload: { reference: receipt.reference, count: slabs.length },
          },
        });
        return { ...receipt, slabs };
      },
      { timeout: 30000 },
    );
  }
}
