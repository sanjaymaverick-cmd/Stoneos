import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PRODUCTION_INPUT_ROLES } from "@stoneos/contracts";
import { operationalDateFor } from "@stoneos/domain";
import { CurrentUser, Roles, type AuthenticatedUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";

@ApiTags("machines")
@ApiBearerAuth()
@Controller("machine-logs")
export class MachineRuntimeController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.machineRuntimeLog.findMany({
      where: { machine: { factoryId: user.factoryId } },
      include: { machine: true },
      orderBy: { operationalDate: "desc" },
    });
  }

  @Post()
  @Roles(...PRODUCTION_INPUT_ROLES)
  async log(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { machineId: string; runtimeHours: number; downtimeMinutes?: number; notes?: string },
  ) {
    const machine = await this.prisma.machine.findFirst({
      where: { id: body.machineId, factoryId: user.factoryId },
    });
    if (!machine) throw new Error("Machine not in this factory");
    const operationalDate = operationalDateFor(new Date());
    return this.prisma.machineRuntimeLog.upsert({
      where: { machineId_operationalDate: { machineId: machine.id, operationalDate } },
      create: {
        machineId: machine.id,
        operationalDate,
        runtimeHours: body.runtimeHours,
        downtimeMinutes: body.downtimeMinutes ?? 0,
        notes: body.notes,
      },
      update: {
        runtimeHours: body.runtimeHours,
        downtimeMinutes: body.downtimeMinutes ?? 0,
        notes: body.notes,
      },
    });
  }
}
