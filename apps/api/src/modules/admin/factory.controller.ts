import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ANY_AUTHENTICATED_ROLE } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("factory")
@ApiBearerAuth()
@Controller("factory")
export class FactoryController {
  constructor(private prisma: PrismaService) {}

  @Get("me")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.factory.findUnique({
      where: { id: user.factoryId },
      select: { id: true, name: true, location: true, operatingStatus: true, goLiveDate: true },
    });
  }
}
