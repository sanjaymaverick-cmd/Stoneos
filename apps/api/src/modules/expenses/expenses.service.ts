import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { assertAllowedRoles } from "../../common/session.guard";
import { EXPENSE_DATA_ROLES, type Role } from "@stoneos/contracts";
import { BooksService } from "../books/books.service";
import {
  GST_DEFAULTS,
  gstOnTaxable,
  minorToRupees,
  parseFactoryDateInput,
  rupeesToMinor,
  stateCodeFromGstin,
} from "../books/money";

export const EXPENSE_CATEGORIES = [
  "diesel",
  "electricity",
  "wages",
  "vehicle",
  "consumables",
  "maintenance",
  "transport",
  "other",
] as const;

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(BooksService) private books: BooksService,
  ) {}

  categories() {
    return EXPENSE_CATEGORIES;
  }

  vehicles(factoryId: string) {
    return this.prisma.vehicle.findMany({ where: { factoryId, active: true }, orderBy: { name: "asc" } });
  }

  createVehicle(user: AuthenticatedUser, name: string) {
    return this.prisma.vehicle.create({ data: { factoryId: user.factoryId, name } });
  }

  list(factoryId: string) {
    return this.prisma.expense.findMany({
      where: { factoryId },
      include: { allocations: true, vehicle: true },
      orderBy: { expenseDate: "desc" },
    });
  }

  async create(
    user: AuthenticatedUser,
    input: {
      category: string;
      amount: number;
      expenseDate: string;
      vehicleId?: string;
      toWhom?: string;
      clientOpId?: string;
      /** Statutory slab on this spend. Omit for a supplier who charged no GST. */
      gstRatePct?: number;
      /** Value before tax. Defaults to the whole amount when no GST was charged. */
      taxableAmount?: number;
      supplierGstin?: string;
    },
  ) {
    // Backstop, not the primary gate — see the same note in SalesService.pay.
    assertAllowedRoles(EXPENSE_DATA_ROLES, user.role as Role);
    if (!EXPENSE_CATEGORIES.includes(input.category as (typeof EXPENSE_CATEGORIES)[number])) {
      throw new BadRequestException("Unknown expense category");
    }
    if (input.category === "vehicle" && !input.vehicleId) {
      throw new BadRequestException("vehicleId is required for vehicle expenses");
    }
    if (input.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: input.vehicleId, factoryId: user.factoryId },
      });
      if (!vehicle) throw new BadRequestException("Vehicle does not belong to this factory");
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.clientOpId) {
        const existing = await tx.expense.findUnique({
          where: { factoryId_idempotencyKey: { factoryId: user.factoryId, idempotencyKey: input.clientOpId } },
        });
        if (existing) return existing;
      }
      const expenseDate = parseFactoryDateInput(input.expenseDate);
      // Only a spend that actually carried GST yields a credit. Diesel from a
      // registered pump does; a labour chit from an unregistered hand does not.
      const claimsCredit = input.gstRatePct != null && input.gstRatePct > 0;
      const profile = claimsCredit
        ? await tx.gstProfile.findUnique({ where: { factoryId: user.factoryId } })
        : null;
      const ourState = profile ? (stateCodeFromGstin(profile.gstin) ?? profile.stateCode) : null;
      const taxable = input.taxableAmount ?? input.amount;
      const gst = claimsCredit && profile
        ? gstOnTaxable(rupeesToMinor(taxable), {
            supplierStateCode: input.supplierGstin
              ? stateCodeFromGstin(input.supplierGstin)
              : ourState,
            placeOfSupplyStateCode: ourState,
            ratePct: input.gstRatePct,
            defaultRatePct: GST_DEFAULTS.expense,
          })
        : undefined;
      const created = await tx.expense.create({
        data: {
          factoryId: user.factoryId,
          category: input.category,
          amount: input.amount,
          expenseDate,
          vehicleId: input.vehicleId,
          toWhom: input.toWhom,
          taxableAmount: gst ? minorToRupees(gst.taxableMinor) : input.amount,
          cgstAmount: gst ? minorToRupees(gst.cgstMinor) : 0,
          sgstAmount: gst ? minorToRupees(gst.sgstMinor) : 0,
          igstAmount: gst ? minorToRupees(gst.igstMinor) : 0,
          gstRatePct: gst ? gst.ratePct : 0,
          supplierGstin: input.supplierGstin?.trim().toUpperCase() || undefined,
          idempotencyKey: input.clientOpId,
        },
      });
      await this.books.postExpense(tx, user, {
        expenseId: created.id,
        category: input.category,
        amount: input.amount,
        gst,
        clientOpId: input.clientOpId ?? `expense:${created.id}`,
        method: "cash",
        date: expenseDate,
      });
      return created;
    });
  }

  async allocate(
    user: AuthenticatedUser,
    expenseId: string,
    batchKey: string,
    allocations: Array<{ rawBlockId: string; allocatedAmount: number }>,
  ) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, factoryId: user.factoryId },
      include: { allocations: true },
    });
    if (!expense) throw new BadRequestException("Expense not found");
    const existing = expense.allocations.reduce((sum, row) => sum + Number(row.allocatedAmount), 0);
    const incoming = allocations.reduce((sum, row) => sum + row.allocatedAmount, 0);
    if (existing + incoming > Number(expense.amount) + 0.001) {
      throw new BadRequestException("Allocation exceeds expense total");
    }
    for (const row of allocations) {
      const block = await this.prisma.rawBlock.findFirst({
        where: { id: row.rawBlockId, factoryId: user.factoryId },
      });
      if (!block) throw new BadRequestException("Raw block does not belong to this factory");
    }
    return this.prisma.expenseAllocation.createMany({
      data: allocations.map((row) => ({
        expenseId,
        rawBlockId: row.rawBlockId,
        allocatedAmount: row.allocatedAmount,
        allocationBatchKey: batchKey,
      })),
    });
  }
}
