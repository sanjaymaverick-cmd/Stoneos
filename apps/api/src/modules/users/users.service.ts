import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hashPassword } from "@stoneos/auth";
import type { PublicUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";
import { readName, readPassword, readStaffType, readUsername } from "../auth/input";
import { toPublic } from "../auth/auth.service";

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(actor: PublicUser): Promise<PublicUser[]> {
    this.assertOwner(actor);
    const users = await this.prisma.user.findMany({
      where: { factoryId: actor.factoryId },
      include: { factory: true },
      orderBy: [{ userType: "asc" }, { name: "asc" }],
    });
    return users.map(toPublic);
  }

  async create(actor: PublicUser, body: unknown): Promise<PublicUser> {
    this.assertOwner(actor);
    const record = isRecord(body) ? body : {};
    const name = readName(record.name, "Name");
    const username = readUsername(record.username);
    const password = readPassword(record.password);
    const userType = readStaffType(record.userType);
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.prisma.user.create({
        data: { factoryId: actor.factoryId, username, name, userType, passwordHash },
        include: { factory: true },
      });
      return toPublic(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That username is already used");
      }
      throw error;
    }
  }

  private assertOwner(actor: PublicUser) {
    if (actor.userType !== "OWNER") {
      throw new ForbiddenException("Only the owner can add people");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
