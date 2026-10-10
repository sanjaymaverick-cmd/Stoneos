import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from "@nestjs/common";
import { CurrentUser, type PublicUser } from "../../common/current-user";
import { OpeningService } from "./opening.service";

@Controller("opening")
export class OpeningController {
  constructor(@Inject(OpeningService) private readonly opening: OpeningService) {}

  @Get()
  get(@CurrentUser() user: PublicUser) {
    return this.opening.get(user);
  }

  @Post("accounts")
  addAccount(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.addAccount(user, body);
  }

  @Delete("accounts/:id")
  removeAccount(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.opening.removeAccount(user, id);
  }

  @Post("parties")
  addParty(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.addParty(user, body);
  }

  @Delete("parties/:id")
  removeParty(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.opening.removeParty(user, id);
  }

  @Post("items")
  addItem(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.addItem(user, body);
  }

  @Delete("items/:id")
  removeItem(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.opening.removeItem(user, id);
  }

  @Post("blocks")
  addBlock(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.addBlock(user, body);
  }

  @Delete("blocks/:id")
  removeBlock(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.opening.removeBlock(user, id);
  }

  @Post("slabs")
  addSlab(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.addSlab(user, body);
  }

  @Delete("slabs/:id")
  removeSlab(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.opening.removeSlab(user, id);
  }

  @Post("store")
  addStore(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.addStore(user, body);
  }

  @Delete("store/:id")
  removeStore(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.opening.removeStore(user, id);
  }

  @Put("settled")
  saveSettled(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.opening.saveSettled(user, body);
  }
}
