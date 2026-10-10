import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hashPassword } from "@stoneos/auth";
import type { PublicUser } from "../../common/current-user";
import { PrismaService } from "../../common/prisma.service";
import { readName, readPassword, readUsername } from "../auth/input";
import { toPublic } from "../auth/auth.service";

@Injectable()
export class SetupService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async status(): Promise<{ needed: boolean }> {
    const users = await this.prisma.user.count();
    return { needed: users === 0 };
  }

  async createOwner(body: unknown): Promise<PublicUser> {
    const record = isRecord(body) ? body : {};
    const factoryName = readName(record.factoryName, "Factory name");
    const name = readName(record.name, "Your name");
    const username = readUsername(record.username);
    const password = readPassword(record.password);
    const passwordHash = await hashPassword(password);

    try {
      const user = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.user.findFirst({ select: { id: true } });
          if (existing) throw new ConflictException("The owner login already exists");
          const factory = await tx.factory.create({ data: { name: factoryName } });
          return tx.user.create({
            data: {
              factoryId: factory.id,
              username,
              name,
              userType: "OWNER",
              passwordHash,
            },
            include: { factory: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return toPublic(user);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That username is already used");
      }
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
