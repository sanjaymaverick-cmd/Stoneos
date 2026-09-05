import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PRODUCTION_INPUT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("consumables")
@ApiBearerAuth()
@Controller("consumables")
export class ConsumablesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.consumable.findMany({ where: { factoryId: user.factoryId } });
  }

  @Post()
  @Roles(...PRODUCTION_INPUT_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; unit: string; onHand?: number },
  ) {
    return this.prisma.consumable.create({
      data: {
        factoryId: user.factoryId,
        name: body.name,
        unit: body.unit,
        onHand: body.onHand ?? 0,
      },
    });
  }
}
