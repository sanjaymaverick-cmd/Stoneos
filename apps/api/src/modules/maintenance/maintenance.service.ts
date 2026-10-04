import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { parseOccurredAt } from "../../common/occurred-at";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { parseOperationalDate } from "@stoneos/domain";

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
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
    if (!input.title?.trim())
      throw new BadRequestException("Maintenance title is required");
    let dueOn: Date;
    try {
      dueOn = parseOperationalDate(input.dueOn);
    } catch {
      throw new BadRequestException("Due date must be a real YYYY-MM-DD date");
    }
    const machine = await this.prisma.machine.findFirst({
      where: { id: input.machineId, factoryId: user.factoryId },
    });
    if (!machine) throw new NotFoundException("Machine not in this factory");
    const job = await this.prisma.maintenanceJob.create({
      data: {
        factoryId: user.factoryId,
        machineId: machine.id,
        title: input.title.trim(),
        dueOn,
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

  async complete(user: AuthenticatedUser, id: string, occurredAt?: string) {
    const completedAt = parseOccurredAt(occurredAt);
    const job = await this.prisma.maintenanceJob.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!job) throw new NotFoundException("Job not found");
    if (job.completedAt) return job;
    const today = new Date(Date.now() + 5.5 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    if (job.dueOn.toISOString().slice(0, 10) > today)
      throw new BadRequestException("Maintenance is not due yet");
    const completed = await this.prisma.maintenanceJob.update({
      where: { id },
      data: { completedAt },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "maintenance.complete",
      entityType: "maintenance_job",
      entityId: id,
    });
    return completed;
  }

  async reschedule(
    user: AuthenticatedUser,
    id: string,
    due: string,
    reason: string,
  ) {
    if (!reason?.trim())
      throw new BadRequestException("Rescheduling reason is required");
    let dueOn: Date;
    try {
      dueOn = parseOperationalDate(due);
    } catch {
      throw new BadRequestException("Due date must be a real YYYY-MM-DD date");
    }
    const job = await this.prisma.maintenanceJob.findFirst({
      where: { id, factoryId: user.factoryId },
    });
    if (!job) throw new NotFoundException("Job not found");
    if (job.completedAt)
      throw new BadRequestException(
        "Completed maintenance cannot be rescheduled",
      );
    const updated = await this.prisma.maintenanceJob.update({
      where: { id },
      data: { dueOn },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "maintenance.reschedule",
      entityType: "maintenance_job",
      entityId: id,
      payload: {
        previousDate: job.dueOn.toISOString(),
        due,
        reason: reason.trim(),
      },
    });
    return updated;
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
