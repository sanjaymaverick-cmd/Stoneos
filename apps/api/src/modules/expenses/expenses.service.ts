import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";

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
  constructor(private prisma: PrismaService) {}

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
    },
  ) {
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
    return this.prisma.expense.create({
      data: {
        factoryId: user.factoryId,
        category: input.category,
        amount: input.amount,
        expenseDate: new Date(input.expenseDate),
        vehicleId: input.vehicleId,
        toWhom: input.toWhom,
        idempotencyKey: input.clientOpId,
      },
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
