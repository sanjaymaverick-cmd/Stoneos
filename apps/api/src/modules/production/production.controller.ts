import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PRODUCTION_INPUT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { ProductionService } from "./production.service";

@ApiTags("production")
@ApiBearerAuth()
@Controller()
export class ProductionController {
  constructor(@Inject(ProductionService) private service: ProductionService) {}

  @Get("machines")
  @Roles(...PRODUCTION_INPUT_ROLES)
  machines(@CurrentUser() user: AuthenticatedUser) {
    return this.service.machines(user.factoryId);
  }

  @Get("cutting-sessions")
  @Roles(...PRODUCTION_INPUT_ROLES)
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.service.cuttingSessions(user.factoryId);
  }

  @Get("polishing-sessions")
  @Roles(...PRODUCTION_INPUT_ROLES)
  polishing(@CurrentUser() user: AuthenticatedUser) {
    return this.service.polishingSessions(user.factoryId);
  }

  @Post("cutting-sessions")
  @Roles(...PRODUCTION_INPUT_ROLES)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { rawBlockId: string; machineId: string; expectedSlabCount?: number },
  ) {
    return this.service.startCutting(user, body);
  }

  @Post("cutting-sessions/:id/day-log")
  @Roles(...PRODUCTION_INPUT_ROLES)
  dayLog(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { runtimeHours?: number; downtimeMinutes?: number; notes?: string },
  ) {
    return this.service.logCuttingDay(user, id, body);
  }

  @Post("cutting-sessions/:id/complete")
  @Roles(...PRODUCTION_INPUT_ROLES)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      totalSlabsCut: number;
      finalGoodSlabCount: number;
      lengthFt?: number;
      widthFt?: number;
      thicknessMm?: number;
    },
  ) {
    return this.service.completeCutting(user, id, body);
  }

  @Post("polishing-sessions")
  @Roles(...PRODUCTION_INPUT_ROLES)
  polish(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      machineId: string;
      processType: "GRINDING" | "RESIN" | "POLISHING";
      slabIds: string[];
      finishType?: string;
    },
  ) {
    return this.service.startPolishing(user, body);
  }

  @Post("polishing-sessions/:id/complete")
  @Roles(...PRODUCTION_INPUT_ROLES)
  completePolish(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.completePolishing(user, id);
  }

  @Get("dpr")
  @Roles(...PRODUCTION_INPUT_ROLES)
  dpr(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const end = to ? new Date(to) : new Date();
    return this.service.derivedDpr(user.factoryId, start, end);
  }
}
