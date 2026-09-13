import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { generateTemporaryPassword, hashPassword } from "@stoneos/auth";
import { canGrantOwner, usernameSchema } from "@stoneos/contracts";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import type { AuthenticatedUser } from "../../common/current-user";

@Injectable()
export class FactoriesService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
    @Inject(InventoryService) private inventory: InventoryService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: { name: string; ownerUsername: string; ownerName?: string; location?: string },
  ) {
    if (!canGrantOwner(actor.role)) {
      throw new ForbiddenException("Only an owner can register another factory");
    }
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException("Factory name is required");
    const parsed = usernameSchema.safeParse(input.ownerUsername);
    if (!parsed.success) throw new BadRequestException("Invalid owner username");
    const username = parsed.data;
    const taken = await this.prisma.appUser.findUnique({ where: { username } });
    if (taken) throw new BadRequestException("Username is already taken");

    const password = generateTemporaryPassword();
    const factory = await this.prisma.$transaction(async (tx) => {
      const created = await tx.factory.create({
        data: { name, location: input.location?.trim() || undefined },
      });
      await tx.machine.createMany({
        data: [
          { factoryId: created.id, name: "B-21", machineType: "CUTTING", bladeCount: 21 },
          {
            factoryId: created.id,
            name: "LPM",
            machineType: "POLISHING",
            headCount: 16,
            abrasivesPerHead: 6,
          },
        ],
      });
      await tx.appUser.create({
        data: {
          factoryId: created.id,
          username,
          name: input.ownerName?.trim() || `${name} Owner`,
          role: "owner",
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      });
      return created;
    });
    await this.inventory.ensureDefaultLocations(factory.id);
    await this.audit.record({
      factoryId: actor.factoryId,
      actorId: actor.id,
      action: "factory.create",
      entityType: "factory",
      entityId: factory.id,
      payload: { name: factory.name, ownerUsername: username },
    });
    return {
      factory: {
        id: factory.id,
        name: factory.name,
        location: factory.location,
        operatingStatus: factory.operatingStatus,
      },
      ownerUsername: username,
      password,
    };
  }
}
