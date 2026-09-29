import { Inject, Injectable, UnauthorizedException, BadRequestException } from "@nestjs/common";
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
import {
  LOGIN_ATTEMPTS_BEFORE_LOCK,
  LOGIN_ATTEMPTS_BEFORE_SUSPEND,
  LOGIN_LOCK_MINUTES,
  SESSION_DAYS,
} from "../../config";
import type { AuthenticatedUser } from "../../common/current-user";

/** One wording for every pre-authentication refusal, so nothing leaks which part failed. */
const INVALID_CREDENTIALS = "Invalid username or password";

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AuditService) private audit: AuditService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.appUser.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
    // The dummy hash keeps the timing of an unknown username indistinguishable from
    // a known one, so the endpoint does not double as a username oracle.
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const matches = await verifyPassword(password, hash);

    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const lockedUntil = user.lockedUntil;
    const locked = lockedUntil !== null && lockedUntil.getTime() > Date.now();

    if (!matches) {
      // A wrong password during a lockout is refused without counting. Otherwise the
      // cooldown would be the fastest way to reach the suspend threshold, and anyone
      // who knew a username could burn an account down in one burst.
      if (!locked && user.active) await this.registerFailedLogin(user);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // The password was right, so the person is who they say they are. From here the
    // refusal may say why — telling an attacker who cannot authenticate nothing, and
    // telling a locked-out employee exactly what to do.
    if (user.suspendedAt) {
      throw new UnauthorizedException(
        "This login is suspended after repeated failed attempts. The owner must issue new credentials.",
      );
    }
    if (!user.active) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (locked) {
      const minutes = Math.max(1, Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000));
      throw new UnauthorizedException(
        `Too many failed attempts. This login is locked for another ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    // A clean login clears the slate: someone who mistypes on Monday and gets in on
    // Tuesday is not one bad morning away from suspension.
    if (user.failedLoginCount > 0 || user.lockoutCount > 0 || user.lockedUntil) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockoutCount: 0, lockedUntil: null },
      });
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

  /**
   * Count one wrong password and apply the policy.
   *
   * First round: {@link LOGIN_ATTEMPTS_BEFORE_LOCK} failures lock the account for
   * {@link LOGIN_LOCK_MINUTES}. Second round, after that lock has passed:
   * {@link LOGIN_ATTEMPTS_BEFORE_SUSPEND} more failures suspend it, and only the owner
   * issuing new credentials brings it back.
   */
  private async registerFailedLogin(user: { id: string; factoryId: string; failedLoginCount: number; lockoutCount: number }) {
    const attempts = user.failedLoginCount + 1;
    const threshold =
      user.lockoutCount === 0 ? LOGIN_ATTEMPTS_BEFORE_LOCK : LOGIN_ATTEMPTS_BEFORE_SUSPEND;

    if (attempts < threshold) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: { failedLoginCount: attempts },
      });
      return;
    }

    if (user.lockoutCount === 0) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockoutCount: 1,
          lockedUntil: new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000),
        },
      });
      await this.audit.record({
        factoryId: user.factoryId,
        actorId: user.id,
        action: "auth.locked",
        entityType: "app_user",
        entityId: user.id,
        payload: { attempts: threshold, minutes: LOGIN_LOCK_MINUTES },
      });
      return;
    }

    // Suspension leaves active = false, the same state a revocation leaves, so every
    // existing guard (including provision() refusing to quietly re-enable it) applies.
    // suspendedAt is what tells the two apart on the roster and in the audit trail.
    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { id: user.id },
        data: {
          active: false,
          suspendedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.authSession.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.audit.record({
      factoryId: user.factoryId,
      actorId: user.id,
      action: "auth.suspended",
      entityType: "app_user",
      entityId: user.id,
      payload: { attempts: threshold },
    });
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
