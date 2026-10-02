import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  INVENTORY_DATA_ROLES,
  PRODUCTION_INPUT_ROLES,
  SALES_DATA_ROLES,
  SALES_READ_ROLES,
} from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { LotsService, type LotLineInput } from "./lots.service";

@ApiTags("lots")
@ApiBearerAuth()
@Controller("lots")
export class LotsController {
  constructor(@Inject(LotsService) private lots: LotsService) {}

  /** "VG-101 — 90 available". The stock screen, by lot rather than by piece. */
  @Get("available")
  @Roles(...SALES_READ_ROLES)
  available(@CurrentUser() user: AuthenticatedUser) {
    return this.lots.availability(user.factoryId);
  }

  /** Record a cut as counts: total off the saw, and how many broke on it. */
  @Post("cut")
  @Roles(...PRODUCTION_INPUT_ROLES)
  cut(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      blockSerial: string;
      totalSlabsCut: number;
      damagedAtSaw?: number;
      sqftPerSlab: number;
      clientOpId: string;
    },
  ) {
    return this.lots.recordCut(user, body);
  }

  /**
   * Remove broken slabs from a lot. Valued, posted to the ledger and attributed —
   * so it is inventory-and-above, not something a sales clerk can do quietly.
   */
  @Post("write-off")
  @Roles(...INVENTORY_DATA_ROLES)
  writeOff(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      blockSerial: string;
      slabCount: number;
      stage: "factory_transport" | "loading" | "yard" | "other";
      reason: string;
      occurredOn?: string;
      clientOpId: string;
    },
  ) {
    return this.lots.writeOffBroken(user, body);
  }

  /** Sell counts from one or more lots as a single order. */
  @Post("sell")
  @Roles(...SALES_DATA_ROLES)
  sell(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: { customerId: string; orderDate?: string; lines: LotLineInput[]; clientOpId: string },
  ) {
    return this.lots.sellLots(user, body);
  }

  /** Orders with slabs still to leave the gate. */
  @Get("pending-dispatch")
  @Roles(...SALES_READ_ROLES)
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.lots.pendingDispatch(user.factoryId);
  }

  /**
   * Send a load out against a lot order. Fulfilment only — the sale already took
   * these slabs out of stock, so nothing is deducted here a second time.
   */
  @Post("dispatch")
  @Roles(...SALES_DATA_ROLES)
  dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      orderId: string;
      lines: Array<{ blockSerial: string; slabCount: number }>;
      clientOpId?: string;
      occurredAt?: string;
    },
  ) {
    return this.lots.dispatchLots(user, body);
  }

  /** One tax invoice for the whole order, with the HSN summary and both addresses. */
  @Post("invoice")
  @Roles(...SALES_DATA_ROLES)
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      orderId: string;
      clientOpId: string;
      shipTo?: { name?: string; address?: string; gstin?: string; stateCode?: string };
    },
  ) {
    return this.lots.invoiceOrder(user, body);
  }
}
