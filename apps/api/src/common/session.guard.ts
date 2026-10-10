import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hashSessionToken } from "@stoneos/auth";
import { IS_PUBLIC, type PublicUser } from "./current-user";
import { PrismaService } from "./prisma.service";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: PublicUser;
    }>();
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) throw new UnauthorizedException("Sign in required");

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { include: { factory: true } } },
    });
    if (!session || session.expiresAt <= new Date() || session.user.disabled) {
      throw new UnauthorizedException("Sign in required");
    }

    request.user = {
      id: session.user.id,
      username: session.user.username,
      name: session.user.name,
      userType: session.user.userType,
      factoryId: session.user.factoryId,
      factoryName: session.user.factory.name,
    };
    return true;
  }
}
