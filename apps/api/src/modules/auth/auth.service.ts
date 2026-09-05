import { Injectable, UnauthorizedException, BadRequestException } from "@nestjs/common";
import {
  DUMMY_PASSWORD_HASH,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "@stoneos/auth";
import { passwordSchema } from "@stoneos/contracts";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import { SESSION_DAYS } from "../../config";
import type { AuthenticatedUser } from "../../common/current-user";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.appUser.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const matches = await verifyPassword(password, hash);
    if (!user || !user.active || !matches) {
      throw new UnauthorizedException("Invalid username or password");
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.authSession.create({
      data: {
        factoryId: user.factoryId,
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "auth.login",
      entityType: "app_user",
      entityId: user.id,
    });
    return { token, expiresAt, user: this.publicUser(user) };
  }

  async logout(sessionId: string, user: AuthenticatedUser) {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "auth.logout",
      entityType: "auth_session",
      entityId: sessionId,
    });
    return { loggedOut: true };
  }

  async changePassword(user: AuthenticatedUser, currentPassword: string, newPassword: string) {
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      throw new BadRequestException("New password must be at least 12 characters");
    }
    const row = await this.prisma.appUser.findUnique({ where: { id: user.id } });
    if (!row?.active || !(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
      }),
      this.prisma.authSession.deleteMany({ where: { userId: user.id } }),
    ]);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.authSession.create({
      data: {
        factoryId: user.factoryId,
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
      },
    });
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "auth.change_password",
      entityType: "app_user",
      entityId: user.id,
    });
    return { token, expiresAt, passwordChanged: true };
  }

  publicUser(user: {
    id: string;
    username: string;
    name: string;
    email: string | null;
    role: string;
    factoryId: string;
    mustChangePassword: boolean;
    active: boolean;
  }) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      factoryId: user.factoryId,
      mustChangePassword: user.mustChangePassword,
      active: user.active,
    };
  }
}
