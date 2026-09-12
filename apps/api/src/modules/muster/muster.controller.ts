import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MUSTER_ATTEND_ROLES, MUSTER_PAY_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { MusterService } from "./muster.service";

@ApiTags("muster")
@ApiBearerAuth()
@Controller("muster")
export class MusterController {
  constructor(@Inject(MusterService) private muster: MusterService) {}

  @Get("workers")
  @Roles(...MUSTER_ATTEND_ROLES, ...MUSTER_PAY_ROLES)
  workers(@CurrentUser() user: AuthenticatedUser) {
    return this.muster.workers(user.factoryId);
  }

  @Post("workers")
  @Roles(...MUSTER_PAY_ROLES)
  createWorker(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; kind?: "cutter" | "polisher" | "helper" | "driver" | "other"; dailyWage?: number },
  ) {
    return this.muster.createWorker(user, body);
  }

  @Get("attendance")
  @Roles(...MUSTER_ATTEND_ROLES, ...MUSTER_PAY_ROLES)
  attendance(@CurrentUser() user: AuthenticatedUser, @Query("date") date?: string) {
    return this.muster.attendance(user.factoryId, date ?? new Date().toISOString().slice(0, 10));
  }

  @Post("attendance")
  @Roles(...MUSTER_ATTEND_ROLES)
  mark(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { workerId: string; date: string; status: "present" | "absent" | "half" | "ot"; otHours?: number },
  ) {
    return this.muster.mark(user, body);
  }

  @Get("sheets")
  @Roles(...MUSTER_PAY_ROLES)
  sheets(@CurrentUser() user: AuthenticatedUser) {
    return this.muster.sheets(user.factoryId);
  }

  @Post("sheets")
  @Roles(...MUSTER_PAY_ROLES)
  draft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { periodStart: string; periodEnd: string; clientOpId: string },
  ) {
    return this.muster.draftSheet(user, body);
  }

  @Post("sheets/:id/confirm")
  @Roles(...MUSTER_PAY_ROLES)
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.muster.confirm(user, id);
  }

  @Post("sheets/:id/pay")
  @Roles(...MUSTER_PAY_ROLES)
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { method?: string },
  ) {
    return this.muster.pay(user, id, body.method ?? "cash");
  }
}
