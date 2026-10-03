import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PAYMENT_ROLES, SALES_DATA_ROLES, SALES_READ_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { SalesService } from "./sales.service";

@ApiTags("sales")
@ApiBearerAuth()
@Controller()
export class SalesController {
  constructor(@Inject(SalesService) private service: SalesService) {}

  @Get("customers")
  @Roles(...SALES_READ_ROLES)
  customers(@CurrentUser() user: AuthenticatedUser) {
    return this.service.customers(user.factoryId);
  }

  @Post("customers")
  @Roles(...SALES_DATA_ROLES)
  createCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      name: string;
      contactInfo?: string;
      stateCode?: string;
      gstin?: string;
      /** Printed as "Bill to". Without it the invoice reads "no address on file". */
      billingAddress?: string;
      /** Where the lorry goes, when that is not the billing address. */
      shippingAddress?: string;
    },
  ) {
    return this.service.createCustomer(user, body.name, body.contactInfo, {
      stateCode: body.stateCode,
      gstin: body.gstin,
      billingAddress: body.billingAddress,
      shippingAddress: body.shippingAddress,
    });
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
      billingMode?: "gst_invoice" | "cash_unbilled";
      lines: Array<{ slabId?: string; quantitySqft: number; rate: number; baseVersion?: number }>;
      partial?: boolean;
    },
  ) {
    return this.service.createOrder(user, body);
  }

  @Post("sales-orders/:id/packing")
  @Roles(...SALES_DATA_ROLES)
  pack(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { slabIds: string[]; partial?: boolean; clientOpId?: string },
  ) {
    return this.service.pack(user, id, body.slabIds, body.partial === true);
  }

  @Post("sales-orders/:id/dispatch")
  @Roles(...SALES_DATA_ROLES)
  dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      slabIds: string[];
      clientOpId?: string;
      vehicleId?: string;
      ewayDraftId?: string;
      invoiceId?: string;
      partial?: boolean;
      occurredAt?: string;
    },
  ) {
    return this.service.dispatch(user, id, body.slabIds, body);
  }

  @Post("sales-orders/:id/invoice")
  @Roles(...SALES_DATA_ROLES)
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      clientOpId: string;
      /** Packaging, demurrage, labour and the like. Taxed with the slabs by default. */
      charges?: Array<{ label: string; amount: number; taxable?: boolean }>;
      /** Statutory slab for this supply; defaults to 18% for finished slabs. */
      gstRatePct?: number;
    },
  ) {
    return this.service.invoice(user, id, body.clientOpId, body.charges ?? [], body.gstRatePct);
  }

  /**
   * Settle an order in cash with no invoice. Raises no GST document and never reaches
   * GSTR-1; the stock movement and the cash are still recorded.
   */
  @Post("sales-orders/:id/cash-sale")
  @Roles(...PAYMENT_ROLES)
  cashSale(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: { amount: number; saleDate: string; clientOpId: string; buyerName?: string; note?: string },
  ) {
    return this.service.recordCashSale(user, id, body);
  }

  @Post("invoices/:id/payments")
  @Roles(...PAYMENT_ROLES)
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { amount: number; method: string; paidAt: string; clientOpId: string; baseVersion?: number },
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
