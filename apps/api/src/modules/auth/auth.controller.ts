import { Body, Controller, Get, Headers, Inject, Post } from "@nestjs/common";
import { CurrentUser, Public, type PublicUser } from "../../common/current-user";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() body: unknown) {
    return this.auth.login(body);
  }

  @Post("logout")
  logout(@CurrentUser() user: PublicUser, @Headers("authorization") header?: string) {
    return this.auth.logout(user, header);
  }

  @Get("me")
  me(@CurrentUser() user: PublicUser) {
    return user;
  }
}
