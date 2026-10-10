import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { Public } from "../../common/current-user";
import { SetupService } from "./setup.service";

@Controller("setup")
export class SetupController {
  constructor(@Inject(SetupService) private readonly setup: SetupService) {}

  @Public()
  @Get()
  status() {
    return this.setup.status();
  }

  @Public()
  @Post()
  createOwner(@Body() body: unknown) {
    return this.setup.createOwner(body);
  }
}
