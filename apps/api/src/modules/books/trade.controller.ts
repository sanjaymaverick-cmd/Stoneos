import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BOOKS_STATEMENT_ROLES, HISTORICAL_IMPORT_ROLES, PAYMENT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { TradeService } from "./trade.service";
@ApiTags("books")
@ApiBearerAuth()
@Controller("books/trades")
export class TradeController {
  constructor(@Inject(TradeService) private service: TradeService) {}
  @Get() @Roles(...BOOKS_STATEMENT_ROLES)
  list(@CurrentUser() user: AuthenticatedUser) { return this.service.list(user.factoryId); }
  @Get("ledger-sales") @Roles(...BOOKS_STATEMENT_ROLES)
  ledgerSales(@CurrentUser() user: AuthenticatedUser) { return this.service.ledgerSales(user.factoryId); }
  @Get("accounts") @Roles(...BOOKS_STATEMENT_ROLES)
  accounts(@CurrentUser() user: AuthenticatedUser) { return this.service.funds(user.factoryId); }
  @Post() @Roles(...HISTORICAL_IMPORT_ROLES)
  create(@CurrentUser() user: AuthenticatedUser,@Body() body: unknown) { return this.service.create(user,body); }
  @Post(":id/payments") @Roles(...PAYMENT_ROLES)
  settle(@CurrentUser() user: AuthenticatedUser,@Param("id") id: string,@Body() body: unknown) { return this.service.settle(user,id,body); }
}
