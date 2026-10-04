import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PRODUCTION_INPUT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { MaintenanceService } from "./maintenance.service";

@ApiTags("maintenance")
@ApiBearerAuth()
@Controller("maintenance")
export class MaintenanceController {
  constructor(@Inject(MaintenanceService) private service: MaintenanceService) {}

  @Post(":id/reschedule")
  @Roles(...PRODUCTION_INPUT_ROLES)
  reschedule(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string,
    @Body() body: {dueOn:string;reason:string}) {
    return this.service.reschedule(user,id,body.dueOn,body.reason);
  }

  @Get()
  @Roles(...PRODUCTION_INPUT_ROLES)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.factoryId);
  }

  @Get("alerts")
  @Roles(...PRODUCTION_INPUT_ROLES)
  alerts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.alerts(user.factoryId);
  }

  @Post()
  @Roles(...PRODUCTION_INPUT_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { machineId: string; title: string; dueOn: string; notes?: string },
  ) {
    return this.service.create(user, body);
  }

  @Post(":id/complete")
  @Roles(...PRODUCTION_INPUT_ROLES)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { occurredAt?: string; clientOpId?: string } = {},
  ) {
    return this.service.complete(user, id, body?.occurredAt);
  }
}
