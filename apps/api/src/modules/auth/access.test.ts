import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import EmbeddedPostgres from "embedded-postgres";
import { AuthService } from "./auth.service";
import { SetupService } from "../setup/setup.service";
import { UsersService } from "../users/users.service";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function database(): Promise<{ url: string; close: () => Promise<void> }> {
  if (process.env.DATABASE_URL) {
    const probe = new PrismaClient();
    try {
      await probe.$queryRaw`SELECT 1`;
      const count = await probe.user.count();
      await probe.$disconnect();
      if (count === 0) return { url: process.env.DATABASE_URL, close: async () => undefined };
    } catch {
      await probe.$disconnect().catch(() => undefined);
    }
  }

  const pg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(path.join(tmpdir(), "stoneos-pg-")),
    user: "stoneos",
    password: "stoneos_ci",
    port: 55432,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--set=io_method=sync"],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("stoneos");
  const url = "postgresql://stoneos:stoneos_ci@127.0.0.1:55432/stoneos";
  execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  return { url, close: () => pg.stop() };
}

test("owner can add office and yard, and they cannot add people", async () => {
  const db = await database();
  process.env.DATABASE_URL = db.url;
  const prisma = new PrismaClient();
  const setup = new SetupService(prisma as never);
  const auth = new AuthService(prisma as never);
  const users = new UsersService(prisma as never);
  let factoryId = "";
  try {
    const owner = await setup.createOwner({
      factoryName: "Vedam Granites",
      name: "Vedam Owner",
      username: "owner",
      password: "OwnerPass@121x",
    });
    factoryId = owner.factoryId;
    assert.equal(owner.userType, "OWNER");
    assert.equal((await setup.status()).needed, false);

    await assert.rejects(
      () => auth.login({ username: "owner", password: "wrong-password-xx" }),
      UnauthorizedException,
    );
    const signedIn = await auth.login({ username: "owner", password: "OwnerPass@121x" });
    assert.equal(signedIn.user.factoryName, "Vedam Granites");

    const office = await users.create(signedIn.user, {
      name: "Office Desk",
      username: "office",
      password: "OfficePass@121",
      userType: "OFFICE",
    });
    const yard = await users.create(signedIn.user, {
      name: "Yard Desk",
      username: "yard",
      password: "YardPass@121x",
      userType: "YARD",
    });
    assert.deepEqual([office.userType, yard.userType], ["OFFICE", "YARD"]);
    await assert.rejects(
      () =>
        users.create(office, {
          name: "Extra",
          username: "extra",
          password: "ExtraPass@121x",
          userType: "YARD",
        }),
      ForbiddenException,
    );

    assert.equal((await users.list(signedIn.user)).length, 3);
    await auth.logout(signedIn.user, `Bearer ${signedIn.token}`);
    assert.equal(await prisma.session.count({ where: { userId: owner.id } }), 0);
  } finally {
    if (factoryId) {
      await prisma.session.deleteMany({ where: { user: { factoryId } } });
      await prisma.user.deleteMany({ where: { factoryId } });
      await prisma.factory.deleteMany({ where: { id: factoryId } });
    }
    await prisma.$disconnect();
    await db.close();
  }
});
