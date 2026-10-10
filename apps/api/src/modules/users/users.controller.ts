import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { CurrentUser, type PublicUser } from "../../common/current-user";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.users.list(user);
  }

  @Post()
  create(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.users.create(user, body);
  }
}
