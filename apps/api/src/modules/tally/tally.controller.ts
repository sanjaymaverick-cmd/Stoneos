import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { HISTORICAL_IMPORT_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { TallyService } from "./tally.service";

@ApiTags("tally")
@ApiBearerAuth()
@Controller("tally")
export class TallyController {
  constructor(private service: TallyService) {}

  @Post("daybook")
  @Roles(...HISTORICAL_IMPORT_ROLES)
  importDaybook(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { fileName: string; xml: string },
  ) {
    return this.service.importDaybook(user, body.fileName, body.xml);
  }
}
