import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ANY_AUTHENTICATED_ROLE, OPERATIONAL_DATA_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { FilesService } from "./files.service";

@ApiTags("files")
@ApiBearerAuth()
@Controller("files")
export class FilesController {
  constructor(@Inject(FilesService) private service: FilesService) {}

  @Get()
  @Roles(...ANY_AUTHENTICATED_ROLE)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.factoryId);
  }

  @Post()
  @Roles(...OPERATIONAL_DATA_ROLES)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { fileName: string; contentType: string; base64: string },
  ) {
    return this.service.upload(user, body);
  }
}
