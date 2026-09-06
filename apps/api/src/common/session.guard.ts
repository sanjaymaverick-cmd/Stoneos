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
import type { Role } from "@stoneos/contracts";
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
      role: user.role as Role,
      factoryId: user.factoryId,
      mustChangePassword: user.mustChangePassword,
      active: user.active,
      sessionId: session.id,
    };
    request.user = authUser;

    const path: string = request.path ?? "";
    const isPasswordChange = path.endsWith("/auth/change-password") || path.endsWith("/auth/logout");
    if (user.mustChangePassword && !isPasswordChange && request.method !== "GET") {
      throw new ForbiddenException("Temporary password must be changed before continuing");
    }

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    assertAllowedRoles(allowed, authUser.role);
    return true;
  }
}
