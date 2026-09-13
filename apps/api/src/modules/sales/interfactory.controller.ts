import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CEO_ROLES, PAYMENT_ROLES, USER_MANAGEMENT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { InterfactoryService } from "./interfactory.service";
import { FactoriesService } from "../admin/factories.service";

@ApiTags("interfactory")
@ApiBearerAuth()
@Controller("interfactory")
export class InterfactoryController {
  constructor(
    @Inject(InterfactoryService) private service: InterfactoryService,
    @Inject(FactoriesService) private factories: FactoriesService,
  ) {}

  @Get("factories")
  @Roles(...CEO_ROLES, ...USER_MANAGEMENT_ROLES)
  factoriesList(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listSisters(user);
  }

  @Post("factories")
  @Roles("owner")
  createFactory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; ownerUsername: string; ownerName?: string; location?: string },
  ) {
    return this.factories.create(user, body);
  }

  @Post("links")
  @Roles(...USER_MANAGEMENT_ROLES)
  link(@CurrentUser() user: AuthenticatedUser, @Body() body: { sisterFactoryId: string }) {
    return this.service.link(user, body.sisterFactoryId);
  }

  @Get("positions")
  @Roles(...CEO_ROLES)
  positions(@CurrentUser() user: AuthenticatedUser) {
    return this.service.positions(user);
  }

  @Get("payables")
  @Roles(...CEO_ROLES, ...PAYMENT_ROLES)
  payables(@CurrentUser() user: AuthenticatedUser) {
    return this.service.payables(user);
  }

  @Post("payables/:id/pay")
  @Roles(...PAYMENT_ROLES)
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { amount: number; method: string; paidAt: string; clientOpId: string },
  ) {
    return this.service.payPayable(user, id, body);
  }
}
