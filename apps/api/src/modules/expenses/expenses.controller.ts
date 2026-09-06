import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { EXPENSE_DATA_ROLES } from "@stoneos/contracts";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { ExpensesService } from "./expenses.service";

@ApiTags("expenses")
@ApiBearerAuth()
@Controller("expenses")
export class ExpensesController {
  constructor(@Inject(ExpensesService) private service: ExpensesService) {}

  @Get("categories")
  @Roles(...EXPENSE_DATA_ROLES)
  categories() {
    return this.service.categories();
  }

  @Get("vehicles")
  @Roles(...EXPENSE_DATA_ROLES)
  vehicles(@CurrentUser() user: AuthenticatedUser) {
    return this.service.vehicles(user.factoryId);
  }

  @Post("vehicles")
  @Roles(...EXPENSE_DATA_ROLES)
  createVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string },
  ) {
    return this.service.createVehicle(user, body.name);
  }

  @Get()
  @Roles(...EXPENSE_DATA_ROLES)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.factoryId);
  }

  @Post()
  @Roles(...EXPENSE_DATA_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      category: string;
      amount: number;
      expenseDate: string;
      vehicleId?: string;
      toWhom?: string;
      clientOpId?: string;
    },
  ) {
    return this.service.create(user, body);
  }

  @Post(":id/allocate")
  @Roles(...EXPENSE_DATA_ROLES)
  allocate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { batchKey: string; allocations: Array<{ rawBlockId: string; allocatedAmount: number }> },
  ) {
    return this.service.allocate(user, id, body.batchKey, body.allocations);
  }
}
