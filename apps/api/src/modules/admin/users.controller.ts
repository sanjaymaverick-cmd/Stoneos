import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { USER_MANAGEMENT_ROLES, provisionUserRequestSchema } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { ZodPipe } from "../../common/zod-pipe";
import { UsersService } from "./users.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/users")
@Roles(...USER_MANAGEMENT_ROLES)
export class UsersController {
  constructor(@Inject(UsersService) private service: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.factoryId);
  }

  @Post()
  provision(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(provisionUserRequestSchema))
    body: { username: string; name?: string; email?: string | null; role: string },
  ) {
    return this.service.provision(user, body);
  }

  @Post(":id/revoke")
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.revoke(user, id);
  }

  /** Restore a disabled account. Issues a new password, returned once. */
  @Post(":id/reactivate")
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.reactivate(user, id);
  }

  @Post(":id/reset-password")
  resetPassword(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.resetPassword(user, id);
  }
}
