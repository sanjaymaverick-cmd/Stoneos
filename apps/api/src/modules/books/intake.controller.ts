import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { INTAKE_DRAFT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { IntakeService } from "./intake.service";

@ApiTags("intake")
@ApiBearerAuth()
@Controller("intake")
export class IntakeController {
  constructor(@Inject(IntakeService) private intake: IntakeService) {}

  @Get("drafts")
  @Roles(...INTAKE_DRAFT_ROLES)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.intake.list(user.factoryId);
  }

  @Post("drafts")
  @Roles(...INTAKE_DRAFT_ROLES)
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      kind: "rokad" | "dpr";
      date: string;
      fileName: string;
      contentType: string;
      base64: string;
    },
  ) {
    return this.intake.propose(user, body);
  }

  @Post("drafts/:id/confirm")
  @Roles(...INTAKE_DRAFT_ROLES)
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.intake.confirm(user, id);
  }

  @Post("drafts/:id/reject")
  @Roles(...INTAKE_DRAFT_ROLES)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { reason: string },
  ) {
    return this.intake.reject(user, id, body.reason ?? "rejected");
  }
}
