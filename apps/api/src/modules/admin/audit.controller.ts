import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AUDIT_READ_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit")
@Roles(...AUDIT_READ_ROLES)
export class AuditController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    const take = Math.min(200, Number(limit ?? 50) || 50);
    return this.prisma.auditEvent.findMany({
      where: { factoryId: user.factoryId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }
}
