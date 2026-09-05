import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { generateTemporaryPassword, hashPassword } from "@stoneos/auth";
import {
  OWNER_ROLE,
  STAFF_PROVISIONABLE_ROLES,
  canGrantOwner,
  canManageUsers,
  isRole,
  type Role,
} from "@stoneos/contracts";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import type { AuthenticatedUser } from "../../common/current-user";

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  list(factoryId: string) {
    return this.prisma.appUser.findMany({
      where: { factoryId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
  }

  async provision(
    actor: AuthenticatedUser,
    input: { username: string; name?: string; email?: string | null; role: string },
  ) {
    if (!canManageUsers(actor.role)) {
      throw new ForbiddenException("Only owners and managers can manage users");
    }
    if (!isRole(input.role)) throw new BadRequestException("Invalid role");
    if (input.role === OWNER_ROLE && !canGrantOwner(actor.role)) {
      throw new ForbiddenException("Only an owner can grant the owner role");
    }
    if (input.role !== OWNER_ROLE && !STAFF_PROVISIONABLE_ROLES.includes(input.role)) {
      throw new BadRequestException("Role cannot be provisioned");
    }

    const username = input.username.trim().toLowerCase();
    const existing = await this.prisma.appUser.findUnique({ where: { username } });
    if (existing && existing.factoryId !== actor.factoryId) {
      throw new BadRequestException("Username is already taken");
    }
    if (existing?.role === OWNER_ROLE && !canGrantOwner(actor.role)) {
      throw new ForbiddenException("Only an owner can change another owner's role");
    }
    if (existing?.id === actor.id && existing.role === OWNER_ROLE && input.role !== OWNER_ROLE) {
      throw new ForbiddenException("You cannot remove your own owner role");
    }

    if (existing) {
      const updated = await this.prisma.appUser.update({
        where: { id: existing.id },
        data: {
          role: input.role,
          active: true,
          name: input.name ?? existing.name,
          email: input.email === undefined ? existing.email : input.email,
        },
      });
      await this.audit.record({
        factoryId: actor.factoryId,
        actorId: actor.id,
        action: "user.role_change",
        entityType: "app_user",
        entityId: updated.id,
        payload: { role: input.role },
      });
      return { created: false, user: updated, password: null };
    }

    const password = generateTemporaryPassword();
    const created = await this.prisma.appUser.create({
      data: {
        factoryId: actor.factoryId,
        username,
        name: input.name?.trim() || username,
        email: input.email ?? null,
        role: input.role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    await this.audit.record({
      factoryId: actor.factoryId,
      actorId: actor.id,
      action: "user.create",
      entityType: "app_user",
      entityId: created.id,
      payload: { role: input.role, username },
    });
    return { created: true, user: created, password };
  }

  async revoke(actor: AuthenticatedUser, userId: string) {
    const target = await this.requireSameFactory(actor, userId);
    this.assertOwnerGuard(actor, target.role as Role, target.id, "revoke");
    await this.prisma.$transaction([
      this.prisma.appUser.update({ where: { id: userId }, data: { active: false } }),
      this.prisma.authSession.deleteMany({ where: { userId } }),
    ]);
    await this.audit.record({
      factoryId: actor.factoryId,
      actorId: actor.id,
      action: "user.revoke",
      entityType: "app_user",
      entityId: userId,
    });
    return { revoked: true };
  }

  async resetPassword(actor: AuthenticatedUser, userId: string) {
    const target = await this.requireSameFactory(actor, userId);
    this.assertOwnerGuard(actor, target.role as Role, target.id, "reset");
    const password = generateTemporaryPassword();
    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.authSession.deleteMany({ where: { userId } }),
    ]);
    await this.audit.record({
      factoryId: actor.factoryId,
      actorId: actor.id,
      action: "user.reset_password",
      entityType: "app_user",
      entityId: userId,
    });
    return { password };
  }

  private async requireSameFactory(actor: AuthenticatedUser, userId: string) {
    const target = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!target || target.factoryId !== actor.factoryId) throw new NotFoundException("User not found");
    return target;
  }

  private assertOwnerGuard(actor: AuthenticatedUser, targetRole: Role, targetId: string, verb: string) {
    if (!canManageUsers(actor.role)) {
      throw new ForbiddenException("Only owners and managers can manage users");
    }
    if (targetRole === OWNER_ROLE && !canGrantOwner(actor.role)) {
      throw new ForbiddenException(`Only an owner can ${verb} an owner account`);
    }
    if (targetId === actor.id && targetRole === OWNER_ROLE) {
      throw new ForbiddenException("You cannot revoke your own owner account");
    }
  }
}
