import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ANY_AUTHENTICATED_ROLE, changePasswordRequestSchema, loginRequestSchema } from "@stoneos/contracts";
import { CurrentUser, Public, Roles, type AuthenticatedUser } from "../../common/current-user";
import { ZodPipe } from "../../common/zod-pipe";
import { AuthService } from "./auth.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private service: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(loginRequestSchema)) body: { username: string; password: string }) {
    return this.service.login(body.username, body.password);
  }

  @ApiBearerAuth()
  @Get("me")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @ApiBearerAuth()
  @Post("logout")
  @HttpCode(200)
  @Roles(...ANY_AUTHENTICATED_ROLE)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.service.logout(user.sessionId, user);
  }

  @ApiBearerAuth()
  @Post("change-password")
  @HttpCode(200)
  @Roles(...ANY_AUTHENTICATED_ROLE)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(changePasswordRequestSchema))
    body: { currentPassword: string; newPassword: string },
  ) {
    return this.service.changePassword(user, body.currentPassword, body.newPassword);
  }
}
