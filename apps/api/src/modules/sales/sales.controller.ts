import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SALES_DATA_ROLES, SALES_READ_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { SalesService } from "./sales.service";

@ApiTags("sales")
@ApiBearerAuth()
@Controller()
export class SalesController {
  constructor(private service: SalesService) {}

  @Get("customers")
  @Roles(...SALES_READ_ROLES)
  customers(@CurrentUser() user: AuthenticatedUser) {
    return this.service.customers(user.factoryId);
  }

  @Post("customers")
  @Roles(...SALES_DATA_ROLES)
  createCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; contactInfo?: string },
  ) {
    return this.service.createCustomer(user, body.name, body.contactInfo);
  }

  @Get("quotations")
  @Roles(...SALES_READ_ROLES)
  quotations(@CurrentUser() user: AuthenticatedUser) {
    return this.service.quotations(user.factoryId);
  }

  @Get("sales-orders")
  @Roles(...SALES_READ_ROLES)
  orders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.orders(user.factoryId);
  }

  @Post("quotations")
  @Roles(...SALES_DATA_ROLES)
  quotation(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      customerId: string;
      lines: Array<{ slabId?: string; description: string; quantitySqft: number; rate: number }>;
    },
  ) {
    return this.service.createQuotation(user, body);
  }

  @Post("sales-orders")
  @Roles(...SALES_DATA_ROLES)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      customerId: string;
      orderDate: string;
      clientOpId: string;
      lines: Array<{ slabId?: string; quantitySqft: number; rate: number }>;
    },
  ) {
    return this.service.createOrder(user, body);
  }

  @Post("sales-orders/:id/packing")
  @Roles(...SALES_DATA_ROLES)
  pack(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { slabIds: string[] },
  ) {
    return this.service.pack(user, id, body.slabIds);
  }

  @Post("sales-orders/:id/dispatch")
  @Roles(...SALES_DATA_ROLES)
  dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { slabIds: string[] },
  ) {
    return this.service.dispatch(user, id, body.slabIds);
  }

  @Post("sales-orders/:id/invoice")
  @Roles(...SALES_DATA_ROLES)
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { clientOpId: string },
  ) {
    return this.service.invoice(user, id, body.clientOpId);
  }

  @Post("invoices/:id/payments")
  @Roles(...SALES_DATA_ROLES)
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { amount: number; method: string; paidAt: string; clientOpId: string },
  ) {
    return this.service.pay(user, id, body);
  }

  @Post("sales-orders/:id/returns")
  @Roles(...SALES_DATA_ROLES)
  returns(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { slabIds: string[]; reason: string },
  ) {
    return this.service.returnSlabs(user, id, body.slabIds, body.reason);
  }

  @Get("recovery-ratio")
  @Roles(...SALES_READ_ROLES)
  recovery(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recovery(user.factoryId);
  }
}
