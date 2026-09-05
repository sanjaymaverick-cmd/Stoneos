import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { InventoryKind } from "@prisma/client";
import { INVENTORY_DATA_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { InventoryService } from "./inventory.service";

@ApiTags("inventory")
@ApiBearerAuth()
@Controller("inventory")
export class InventoryController {
  constructor(private service: InventoryService) {}

  @Get("locations")
  locations(@CurrentUser() user: AuthenticatedUser) {
    return this.service.locations(user.factoryId);
  }

  @Get("raw-blocks")
  rawBlocks(@CurrentUser() user: AuthenticatedUser) {
    return this.service.rawBlocks(user.factoryId);
  }

  @Get("slabs")
  slabs(@CurrentUser() user: AuthenticatedUser) {
    return this.service.slabs(user.factoryId);
  }

  @Get("movements")
  movements(@CurrentUser() user: AuthenticatedUser) {
    return this.service.movements(user.factoryId);
  }

  @Get("opening")
  opening(@CurrentUser() user: AuthenticatedUser) {
    return this.service.openingSnapshots(user.factoryId);
  }

  @Get("suppliers")
  suppliers(@CurrentUser() user: AuthenticatedUser) {
    return this.service.suppliers(user.factoryId);
  }

  @Post("suppliers")
  @Roles(...INVENTORY_DATA_ROLES)
  createSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; contactInfo?: string },
  ) {
    return this.service.createSupplier(user, body.name, body.contactInfo);
  }

  @Post("raw-blocks")
  @Roles(...INVENTORY_DATA_ROLES)
  receiveBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      serialNumber: string;
      varietyName: string;
      supplierId?: string;
      quarry?: string;
      weightTons?: number;
      invoicedAmount?: number;
      actualAmountPaid?: number;
      qualityNote?: string;
      locationCode?: string;
      clientOpId: string;
    },
  ) {
    return this.service.receiveBlock(user, body);
  }

  @Post("opening")
  @Roles(...INVENTORY_DATA_ROLES)
  startOpening(@CurrentUser() user: AuthenticatedUser) {
    return this.service.startOpeningCount(user);
  }

  @Post("opening/:id/lines")
  @Roles(...INVENTORY_DATA_ROLES)
  addLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { kind: InventoryKind; payload: Record<string, string> },
  ) {
    return this.service.addOpeningLine(user, id, body.kind, body.payload);
  }

  @Post("opening/:id/submit")
  @Roles(...INVENTORY_DATA_ROLES)
  submit(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.submitOpening(user, id);
  }

  @Post("opening/:id/approve")
  @Roles("owner", "manager")
  approve(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.approveOpening(user, id);
  }
}
