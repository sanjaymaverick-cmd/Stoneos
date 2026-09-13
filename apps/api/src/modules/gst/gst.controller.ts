import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CEO_ROLES, HISTORICAL_IMPORT_ROLES, SALES_DATA_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { GstService } from "./gst.service";

@ApiTags("gst")
@ApiBearerAuth()
@Controller("gst")
export class GstController {
  constructor(@Inject(GstService) private gst: GstService) {}

  @Get("profile")
  @Roles(...CEO_ROLES)
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.gst.profile(user.factoryId);
  }

  @Post("profile")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { gstin: string; legalName: string; stateCode: string; irpSandbox?: boolean },
  ) {
    return this.gst.upsertProfile(user, body);
  }

  @Post("einvoice/:invoiceId")
  @Roles(...SALES_DATA_ROLES, ...CEO_ROLES)
  einvoice(@CurrentUser() user: AuthenticatedUser, @Param("invoiceId") invoiceId: string) {
    return this.gst.einvoice(user, invoiceId);
  }

  @Post("einvoice/cn/:creditNoteId")
  @Roles(...SALES_DATA_ROLES, ...CEO_ROLES)
  einvoiceCn(@CurrentUser() user: AuthenticatedUser, @Param("creditNoteId") creditNoteId: string) {
    return this.gst.einvoiceCreditNote(user, creditNoteId);
  }

  @Get("einvoice")
  @Roles(...CEO_ROLES)
  listEinvoice(@CurrentUser() user: AuthenticatedUser) {
    return this.gst.listEinvoice(user.factoryId);
  }

  @Post("eway")
  @Roles(...SALES_DATA_ROLES, ...CEO_ROLES)
  eway(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      clientOpId: string;
      invoiceId?: string;
      deliveryId?: string;
      vehicleId?: string;
      distanceKm?: number;
      fromGstin?: string;
      toGstin?: string;
      fromPin?: string;
      toPin?: string;
    },
  ) {
    return this.gst.eway(user, body);
  }

  @Get("eway")
  @Roles(...CEO_ROLES)
  listEway(@CurrentUser() user: AuthenticatedUser) {
    return this.gst.listEway(user.factoryId);
  }

  @Get("gstr1")
  @Roles(...CEO_ROLES)
  gstr1(@CurrentUser() user: AuthenticatedUser, @Query("month") month?: string) {
    const now = new Date();
    const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return this.gst.gstr1(user.factoryId, month ?? fallback);
  }
}
