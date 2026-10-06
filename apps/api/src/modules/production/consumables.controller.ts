import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import {
  CONSUMABLE_UNITS,
  isConsumableUnit,
  PRODUCTION_INPUT_ROLES,
} from "@stoneos/contracts";
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from "../../common/current-user";
import { parseBusinessDate } from "../books/money";
import { PrismaService } from "../../common/prisma.service";
import { queryText, registerPage, type RegisterQuery } from "../../common/registers";

@ApiTags("consumables")
@ApiBearerAuth()
@Controller("consumables")
export class ConsumablesController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  @Get("movements")
  @Roles(...PRODUCTION_INPUT_ROLES)
  async movements(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RegisterQuery = {},
  ) {
    const paging = registerPage(query);
    const q = queryText(query, "q");
    const direction = queryText(query, "direction");
    const where: Prisma.ConsumableMovementWhereInput = {
      factoryId: user.factoryId,
      ...(q
        ? {
            OR: [
              { reason: { contains: q, mode: "insensitive" } },
              { consumable: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(direction ? { direction } : {}),
    };
    const items = await this.prisma.consumableMovement.findMany({
      where,
      include: { consumable: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(paging
        ? { skip: paging.skip, take: paging.pageSize }
        : { skip: 0, take: 200 }),
    });
    return paging
      ? {
          items,
          total: await this.prisma.consumableMovement.count({ where }),
          page: paging.page,
          pageSize: paging.pageSize,
        }
      : items;
  }

  @Post(":id/movements")
  @Roles(...PRODUCTION_INPUT_ROLES)
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      direction: "receipt" | "usage";
      quantity: number;
      reason: string;
      occurredOn: string;
      clientOpId: string;
    },
  ) {
    if (
      !["receipt", "usage"].includes(body.direction) ||
      !Number.isFinite(body.quantity) ||
      body.quantity <= 0 ||
      body.quantity > 1e8 ||
      Math.round(body.quantity * 1000) / 1000 !== body.quantity
    )
      throw new BadRequestException(
        "Use receipt or usage and a positive quantity with at most three decimals",
      );
    if (!body.reason?.trim() || !body.clientOpId?.trim())
      throw new BadRequestException("Reason and operation ID are required");
    const occurredOn = parseBusinessDate(body.occurredOn, "occurredOn");
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.consumableMovement.findUnique({
        where: {
          factoryId_clientOpId: {
            factoryId: user.factoryId,
            clientOpId: body.clientOpId,
          },
        },
      });
      if (old) {
        if (
          old.consumableId !== id ||
          old.direction !== body.direction ||
          Number(old.quantity) !== body.quantity
        )
          throw new ConflictException(
            "Operation ID already used for a different movement",
          );
        return old;
      }
      const stock = await tx.consumable.findFirst({
        where: { id, factoryId: user.factoryId },
      });
      if (!stock)
        throw new BadRequestException(
          "Consumable does not belong to this factory",
        );
      const changed = await tx.consumable.updateMany({
        where: {
          id,
          factoryId: user.factoryId,
          ...(body.direction === "usage"
            ? { onHand: { gte: body.quantity } }
            : {}),
        },
        data: {
          onHand:
            body.direction === "usage"
              ? { decrement: body.quantity }
              : { increment: body.quantity },
        },
      });
      if (!changed.count)
        throw new BadRequestException("Usage exceeds stock on hand");
      return tx.consumableMovement.create({
        data: {
          factoryId: user.factoryId,
          consumableId: id,
          direction: body.direction,
          quantity: body.quantity,
          reason: body.reason.trim(),
          occurredOn,
          actorId: user.id,
          clientOpId: body.clientOpId,
        },
      });
    });
  }

  @Get()
  @Roles(...PRODUCTION_INPUT_ROLES)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RegisterQuery = {},
  ) {
    const paging = registerPage(query);
    const q = queryText(query, "q");
    const where: Prisma.ConsumableWhereInput = {
      factoryId: user.factoryId,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    };
    const items = await this.prisma.consumable.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...(paging ? { skip: paging.skip, take: paging.pageSize } : {}),
    });
    return paging
      ? {
          items,
          total: await this.prisma.consumable.count({ where }),
          page: paging.page,
          pageSize: paging.pageSize,
        }
      : items;
  }

  @Post()
  @Roles(...PRODUCTION_INPUT_ROLES)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; unit: string; onHand?: number },
  ) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException("name is required");
    if (!isConsumableUnit(body.unit)) {
      throw new BadRequestException(
        `unit must be one of: ${CONSUMABLE_UNITS.join(", ")}`,
      );
    }
    const onHand = body.onHand ?? 0;
    if (!Number.isFinite(onHand) || onHand < 0) {
      throw new BadRequestException("onHand cannot be negative");
    }
    try {
      return await this.prisma.consumable.create({
        data: { factoryId: user.factoryId, name, unit: body.unit, onHand },
      });
    } catch (error) {
      // One row per item per factory. A second "Epoxy resin" is a question about
      // the first one, not a crash.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "CONSUMABLE_EXISTS",
          message: `${name} is already on the consumables list`,
        });
      }
      throw error;
    }
  }
}
