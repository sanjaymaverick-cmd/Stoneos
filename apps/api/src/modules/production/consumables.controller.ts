import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { CONSUMABLE_UNITS, isConsumableUnit, PRODUCTION_INPUT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("consumables")
@ApiBearerAuth()
@Controller("consumables")
export class ConsumablesController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  @Get()
  @Roles(...PRODUCTION_INPUT_ROLES)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.consumable.findMany({ where: { factoryId: user.factoryId }, orderBy: { name: "asc" } });
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
      throw new BadRequestException(`unit must be one of: ${CONSUMABLE_UNITS.join(", ")}`);
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({
          code: "CONSUMABLE_EXISTS",
          message: `${name} is already on the consumables list`,
        });
      }
      throw error;
    }
  }
}
