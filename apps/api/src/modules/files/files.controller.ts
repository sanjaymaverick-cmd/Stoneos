import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Param,
  Query,
} from "@nestjs/common";
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
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("entityType") type?: string,
    @Query("entityId") id?: string,
  ) {
    return this.service.list(user.factoryId, type, id);
  }

  @Get(":id")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  read(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.read(user.factoryId, id);
  }

  @Post()
  @Roles(...OPERATIONAL_DATA_ROLES)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      fileName: string;
      contentType: string;
      base64: string;
      entityType?: string;
      entityId?: string;
    },
  ) {
    return this.service.upload(user, body);
  }
}
