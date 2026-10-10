import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword, DUMMY_PASSWORD_HASH } from "@stoneos/auth";
import { SESSION_DAYS } from "../../config";
import type { PublicUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";
import { readPassword, readUsername } from "./input";

const userWithFactory = { include: { factory: true } } as const;

function toPublic(user: {
  id: string;
  username: string;
  name: string;
  userType: PublicUser["userType"];
  factoryId: string;
  factory: { name: string };
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    userType: user.userType,
    factoryId: user.factoryId,
    factoryName: user.factory.name,
  };
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async login(body: unknown): Promise<{ token: string; user: PublicUser }> {
    const record = isRecord(body) ? body : {};
    const username = readUsername(record.username);
    const password = readPassword(record.password);
    const user = await this.prisma.user.findUnique({ where: { username }, ...userWithFactory });
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const matches = await verifyPassword(password, hash);
    if (!user || !matches || user.disabled) {
      throw new UnauthorizedException("Username or password is wrong");
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt },
    });
    return { token, user: toPublic(user) };
  }

  async logout(user: PublicUser, header: string | undefined): Promise<void> {
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) return;
    await this.prisma.session.deleteMany({
      where: { userId: user.id, tokenHash: hashSessionToken(token) },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { hashPassword, toPublic };
