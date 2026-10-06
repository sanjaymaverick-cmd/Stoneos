import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { assertAllowedRoles } from "../../common/session.guard";
import { EXPENSE_DATA_ROLES, type Role } from "@stoneos/contracts";
import { BooksService } from "../books/books.service";
import {
  GST_DEFAULTS,
  cleanGstin,
  gstOnTaxable,
  minorToRupees,
  parseBusinessDate,
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
    return this.prisma.vehicle.findMany({
      where: { factoryId, active: true },
      orderBy: { name: "asc" },
    });
  }

  createVehicle(user: AuthenticatedUser, name: string) {
    return this.prisma.vehicle.create({
      data: { factoryId: user.factoryId, name },
    });
  }

  async list(factoryId: string, query: Record<string, string> = {}) {
    const paging = query.page !== undefined;
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 50);
    if (
      paging &&
      (!Number.isSafeInteger(page) ||
        page < 1 ||
        page > 1000000 ||
        !Number.isSafeInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100)
    )
      throw new BadRequestException(
        "Use a positive page and pageSize between 1 and 100",
      );
    const term = (query.search ?? "").trim().slice(0, 120);
    const where: Prisma.ExpenseWhereInput = { factoryId };
    if (term) {
      const blocks = await this.prisma.rawBlock.findMany({
        where: {
          factoryId,
          serialNumber: { contains: term, mode: "insensitive" },
        },
        select: { id: true },
      });
      where.OR = [
        { category: { contains: term, mode: "insensitive" } },
        { toWhom: { contains: term, mode: "insensitive" } },
        { vehicle: { name: { contains: term, mode: "insensitive" } } },
        {
          allocations: {
            some: { rawBlockId: { in: blocks.map((b) => b.id) } },
          },
        },
      ];
      if (/^\d{4}-\d{2}-\d{2}$/.test(term) && !Number.isNaN(Date.parse(term)))
        where.OR.push({ expenseDate: new Date(term) });
    }
    const items = await this.prisma.expense.findMany({
      where,
      include: { allocations: true, vehicle: true },
      orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
      ...(paging ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    });
    return paging
      ? {
          items,
          total: await this.prisma.expense.count({ where }),
          page,
          pageSize,
        }
      : items;
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
      paymentMethod?: "cash" | "bank" | "upi";
      /** Statutory slab on this spend. Omit for a supplier who charged no GST. */
      gstRatePct?: number;
      /** Value before tax. Defaults to the whole amount when no GST was charged. */
      taxableAmount?: number;
      supplierGstin?: string;
      blockCost?: {
        rawBlockId: string;
        costComponent: "other" | "royalty" | "block_transport";
      };
    },
  ) {
    // Backstop, not the primary gate — see the same note in SalesService.pay.
    assertAllowedRoles(EXPENSE_DATA_ROLES, user.role as Role);
    if (
      !EXPENSE_CATEGORIES.includes(
        input.category as (typeof EXPENSE_CATEGORIES)[number],
      )
    ) {
      throw new BadRequestException("Unknown expense category");
    }
    if (input.category === "vehicle" && !input.vehicleId) {
      throw new BadRequestException(
        "vehicleId is required for vehicle expenses",
      );
    }
    if (input.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: input.vehicleId, factoryId: user.factoryId },
      });
      if (!vehicle)
        throw new BadRequestException(
          "Vehicle does not belong to this factory",
        );
    }
    if (
      input.paymentMethod &&
      !["cash", "bank", "upi"].includes(input.paymentMethod)
    )
      throw new BadRequestException("Choose cash, bank or UPI");
    return this.prisma.$transaction(async (tx) => {
      if (input.clientOpId) {
        const existing = await tx.expense.findUnique({
          where: {
            factoryId_idempotencyKey: {
              factoryId: user.factoryId,
              idempotencyKey: input.clientOpId,
            },
          },
        });
        if (existing) {
          if (input.blockCost) {
            const assigned = await tx.expenseAllocation.findFirst({
              where: {
                expenseId: existing.id,
                allocationBatchKey: "initial:" + input.clientOpId,
              },
            });
            if (
              !assigned ||
              assigned.rawBlockId !== input.blockCost.rawBlockId ||
              assigned.costComponent !== input.blockCost.costComponent ||
              Number(existing.amount) !== input.amount ||
              existing.category !== input.category ||
              existing.expenseDate.toISOString().slice(0, 10) !==
                input.expenseDate ||
              existing.toWhom !== (input.toWhom ?? null)
            )
              throw new BadRequestException(
                "This operation was already recorded with different expense details",
              );
          }
          return existing;
        }
      }
      if (
        !Number.isFinite(input.amount) ||
        input.amount <= 0 ||
        Math.round(input.amount * 100) / 100 !== input.amount
      )
        throw new BadRequestException(
          "Expense amount must be positive with at most two decimals",
        );
      if (input.blockCost) {
        if (
          !input.clientOpId ||
          !["other", "royalty", "block_transport"].includes(
            input.blockCost.costComponent,
          )
        )
          throw new BadRequestException(
            "Block cost needs a valid component and operation ID",
          );
        const block = await tx.rawBlock.findFirst({
          where: { id: input.blockCost.rawBlockId, factoryId: user.factoryId },
        });
        if (!block)
          throw new BadRequestException(
            "Block does not belong to this factory",
          );
      }
      const expenseDate = parseBusinessDate(input.expenseDate, "expenseDate");
      // Only a spend that actually carried GST yields a credit. Diesel from a
      // registered pump does; a labour chit from an unregistered hand does not.
      const claimsCredit = input.gstRatePct != null && input.gstRatePct > 0;
      const profile = claimsCredit
        ? await tx.gstProfile.findUnique({
            where: { factoryId: user.factoryId },
          })
        : null;
      if (
        input.blockCost &&
        claimsCredit &&
        (!profile || !cleanGstin(input.supplierGstin))
      ) {
        throw new BadRequestException(
          "GST profile and supplier GSTIN are required for charged GST",
        );
      }
      const ourState = profile
        ? (stateCodeFromGstin(profile.gstin) ?? profile.stateCode)
        : null;
      const taxable = input.taxableAmount ?? input.amount;
      const gst =
        claimsCredit && profile
          ? gstOnTaxable(rupeesToMinor(taxable), {
              supplierStateCode: input.supplierGstin
                ? stateCodeFromGstin(input.supplierGstin)
                : ourState,
              placeOfSupplyStateCode: ourState,
              ratePct: input.gstRatePct,
              defaultRatePct: GST_DEFAULTS.expense,
            })
          : undefined;
      if (
        input.blockCost &&
        gst &&
        gst.totalMinor !== rupeesToMinor(input.amount)
      )
        throw new BadRequestException(
          "Paid amount must match taxable cost plus charged GST",
        );
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
        method: input.paymentMethod ?? "cash",
        date: expenseDate,
      });
      if (input.blockCost) {
        await tx.expenseAllocation.create({
          data: {
            expenseId: created.id,
            rawBlockId: input.blockCost.rawBlockId,
            costComponent: input.blockCost.costComponent,
            allocatedAmount: created.taxableAmount ?? created.amount,
            allocationBatchKey: "initial:" + input.clientOpId,
          },
        });
        await tx.rawBlock.update({
          where: { id: input.blockCost.rawBlockId },
          data: { costsConfirmedAt: null },
        });
      }
      return created;
    });
  }

  async allocate(
    user: AuthenticatedUser,
    expenseId: string,
    batchKey: string,
    allocations: Array<{
      rawBlockId: string;
      allocatedAmount: number;
      costComponent?: "other" | "royalty" | "block_transport";
    }>,
  ) {
    if (!batchKey?.trim() || !Array.isArray(allocations) || !allocations.length)
      throw new BadRequestException("Allocation batch and lines are required");
    if (
      new Set(allocations.map((a) => a.rawBlockId)).size !==
        allocations.length ||
      allocations.some(
        (a) => !Number.isFinite(a.allocatedAmount) || a.allocatedAmount <= 0,
      )
    )
      throw new BadRequestException("Use one positive allocation per block");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const expense = await tx.expense.findFirst({
              where: { id: expenseId, factoryId: user.factoryId },
              include: { allocations: true },
            });
            if (!expense) throw new BadRequestException("Expense not found");
            const prior = expense.allocations.filter(
              (a) => a.allocationBatchKey === batchKey,
            );
            if (prior.length) {
              if (
                prior.length !== allocations.length ||
                prior.some(
                  (a) =>
                    !allocations.some(
                      (b) =>
                        b.rawBlockId === a.rawBlockId &&
                        Number(a.allocatedAmount) === b.allocatedAmount &&
                        a.costComponent === (b.costComponent ?? "other"),
                    ),
                )
              )
                throw new BadRequestException(
                  "Batch key already used for different allocations",
                );
              return { count: prior.length };
            }
            const existing = expense.allocations.reduce(
              (n, a) => n + rupeesToMinor(Number(a.allocatedAmount)),
              0,
            );
            const incoming = allocations.reduce(
              (n, a) => n + rupeesToMinor(a.allocatedAmount),
              0,
            );
            if (
              existing + incoming >
              rupeesToMinor(Number(expense.taxableAmount ?? expense.amount))
            )
              throw new BadRequestException(
                "Allocation exceeds expense total before GST",
              );
            const blocks = await tx.rawBlock.count({
              where: {
                factoryId: user.factoryId,
                id: { in: allocations.map((a) => a.rawBlockId) },
              },
            });
            if (blocks !== allocations.length)
              throw new BadRequestException(
                "Raw block does not belong to this factory",
              );
            await tx.rawBlock.updateMany({
              where: {
                factoryId: user.factoryId,
                id: { in: allocations.map((a) => a.rawBlockId) },
              },
              data: { costsConfirmedAt: null },
            });
            return tx.expenseAllocation.createMany({
              data: allocations.map((a) => ({
                expenseId,
                rawBlockId: a.rawBlockId,
                costComponent: a.costComponent ?? "other",
                allocatedAmount: minorToRupees(
                  rupeesToMinor(a.allocatedAmount),
                ),
                allocationBatchKey: batchKey,
              })),
            });
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if ((error as { code?: string }).code === "P2034" && attempt < 2)
          continue;
        throw error;
      }
    }
  }
}
