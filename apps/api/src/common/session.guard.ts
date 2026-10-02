import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hashSessionToken } from "@stoneos/auth";
import { effectiveRole, type Role } from "@stoneos/contracts";
import { PrismaService } from "./prisma.service";
import { IS_PUBLIC, ROLES_KEY, type AuthenticatedUser } from "./current-user";

export function assertAllowedRoles(allowed: Role[] | undefined, role: Role) {
  if (!allowed || allowed.length === 0) {
    throw new ForbiddenException("Route has no role annotation");
  }
  if (!allowed.includes(role)) {
    throw new ForbiddenException("Insufficient role");
  }
}

/** Authorization on persisted roles; historic read-only accounts never gain writes. */
export function assertDailyAccess(role: Role, method: string, path: string) {
  if (path.includes("/auth/")) return;
  const mapped = effectiveRole(role);
  if (["accountant", "auditor"].includes(role)) {
    if (method !== "GET" || !/\/(books|expenses|audit|reports)\b/.test(path))
      throw new ForbiddenException("Read-only access to Money and Audit");
    return;
  }
  if (
    mapped !== "owner" &&
    /\/(admin|audit|expenses|books|gst|tally|intake)\b/.test(path)
  )
    throw new ForbiddenException("Owner access required");
  if (
    mapped === "supervisor" &&
    method !== "GET" &&
    /\/(invoices|sales-orders\/[^/]+\/invoice)(\/|$)/.test(path)
  )
    throw new ForbiddenException("Owner records invoices and payments");
  if (
    mapped === "operator" &&
    method !== "GET" &&
    !/\/(cutting-sessions|polishing-sessions|muster\/attendance)(\/|$)/.test(
      path,
    )
  )
    throw new ForbiddenException(
      "Operator can mark attendance and work Cut sessions",
    );
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(Reflector) private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header = String(request.headers.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException("Authentication required");

    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active) {
      throw new UnauthorizedException("Session is no longer valid");
    }

    const user = session.user;
    const authUser: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: effectiveRole(user.role as Role),
      factoryId: user.factoryId,
      mustChangePassword: user.mustChangePassword,
      active: user.active,
      sessionId: session.id,
    };
    request.user = authUser;

    const path: string = request.path ?? "";
    assertDailyAccess(user.role as Role, request.method, path);

    // A temporary password buys nothing but the ability to replace it. Reads were
    // previously allowed, so a credential slip opened the CEO board, outstanding AR
    // and the CSV exports before it was ever changed.
    const allowedOnTempPassword =
      path.endsWith("/auth/change-password") ||
      path.endsWith("/auth/logout") ||
      // The app shell reads this on every page to know who is signed in; without it
      // the change-password screen cannot render.
      path.endsWith("/auth/me");
    if (user.mustChangePassword && !allowedOnTempPassword) {
      throw new ForbiddenException(
        "Temporary password must be changed before continuing",
      );
    }

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    assertAllowedRoles(allowed, authUser.role);
    return true;
  }
}
