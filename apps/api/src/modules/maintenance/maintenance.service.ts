import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";

@Injectable()
export class MaintenanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list(factoryId: string) {
    return this.prisma.maintenanceJob.findMany({
      where: { factoryId },
      include: { machine: true },
      orderBy: { dueOn: "asc" },
    });
  }

  async create(
    user: AuthenticatedUser,
    input: { machineId: string; title: string; dueOn: string; notes?: string },
  ) {
    const machine = await this.prisma.machine.findFirst({
      where: { id: input.machineId, factoryId: user.factoryId },
    });
    if (!machine) throw new NotFoundException("Machine not in this factory");
    const job = await this.prisma.maintenanceJob.create({
      data: {
        factoryId: user.factoryId,
        machineId: machine.id,
        title: input.title,
        dueOn: new Date(input.dueOn),
        notes: input.notes,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "maintenance.create",
      entityType: "maintenance_job",
      entityId: job.id,
    });
    return job;
  }

  async complete(user: AuthenticatedUser, id: string) {
    const job = await this.prisma.maintenanceJob.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!job) throw new NotFoundException("Job not found");
    return this.prisma.maintenanceJob.update({
      where: { id },
      data: { completedAt: new Date() },
    });
  }

  alerts(factoryId: string) {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    return this.prisma.maintenanceJob.findMany({
      where: { factoryId, completedAt: null, dueOn: { lte: soon } },
      include: { machine: true },
    });
  }
}
