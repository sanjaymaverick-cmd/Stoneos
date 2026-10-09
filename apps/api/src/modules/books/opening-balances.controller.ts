import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { BOOKS_STATEMENT_ROLES, HISTORICAL_IMPORT_ROLES, PAYMENT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { OpeningBalancesService, type OpeningRow } from "./opening-balances.service";

type Draft = { title: string; effectiveDate: string; note?: string; lines: OpeningRow[] };
@Controller("books/openings")
export class OpeningBalancesController {
  constructor(@Inject(OpeningBalancesService) private service: OpeningBalancesService) {}
  @Get()
  @Roles(...BOOKS_STATEMENT_ROLES)
  list(@CurrentUser() user: AuthenticatedUser) { return this.service.list(user.factoryId); }
  @Get("job-stock")
  @Roles(...BOOKS_STATEMENT_ROLES)
  jobStock(@CurrentUser() user: AuthenticatedUser) { return this.service.jobStock(user.factoryId); }
  @Post()
  @Roles(...HISTORICAL_IMPORT_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: Draft & { clientOpId: string }) { return this.service.create(user, body); }
  @Patch(":id")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: Draft & { baseVersion: number }) { return this.service.update(user, id, body); }
  @Post(":id/submit")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  submit(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { baseVersion: number }) { return this.service.transition(user, id, body.baseVersion); }
  @Post(":id/reopen")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  reopen(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { baseVersion: number }) { return this.service.transition(user, id, body.baseVersion, true); }
  @Post(":id/approve")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  approve(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { baseVersion: number; reconciled: boolean }) { return this.service.approve(user, id, body); }
  @Post("lines/:id/settlements")
  @Roles(...PAYMENT_ROLES)
  settle(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { amount: number; method: string; paidAt: string; note?: string; receivedBy?: string; reference?: string; pendingBucket?: "cash" | "bank"; clientOpId: string }) { return this.service.settle(user, id, body); }
}
