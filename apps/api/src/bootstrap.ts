import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@stoneos/auth";
import { InventoryService } from "./modules/inventory/inventory.service";

/**
 * One-time owner bootstrap. Ships in the API image.
 * Refuses to run if an owner already exists.
 *
 *   BOOTSTRAP_TOKEN=... BOOTSTRAP_OWNER_USERNAME=owner \
 *   BOOTSTRAP_OWNER_PASSWORD='ChangeMeNow!12' npx tsx src/bootstrap.ts
 */
async function main() {
  const token = process.env.BOOTSTRAP_TOKEN;
  const username = (process.env.BOOTSTRAP_OWNER_USERNAME ?? "").trim().toLowerCase();
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "";
  const name = process.env.BOOTSTRAP_OWNER_NAME ?? "StoneOS Owner";
  const factoryName = process.env.FACTORY_NAME ?? "Vedam Granites";

  if (!token || token.length < 16) {
    throw new Error("BOOTSTRAP_TOKEN is required and must be at least 16 characters");
  }
  if (!username || password.length < 12) {
    throw new Error("BOOTSTRAP_OWNER_USERNAME and BOOTSTRAP_OWNER_PASSWORD (>=12 chars) are required");
  }

  const prisma = new PrismaClient();
  try {
    const existingLock = await prisma.bootstrapLock.findUnique({ where: { id: "singleton" } });
    if (existingLock) {
      console.log("Bootstrap already completed; refusing to run again");
      return;
    }
    const ownerExists = await prisma.appUser.findFirst({ where: { role: "owner" } });
    if (ownerExists) {
      throw new Error("An owner already exists; bootstrap is one-time");
    }

    const factory = await prisma.$transaction(async (tx) => {
      const created = await tx.factory.create({ data: { name: factoryName } });
      await tx.machine.createMany({
        data: [
          { factoryId: created.id, name: "B-21", machineType: "CUTTING", bladeCount: 21 },
          {
            factoryId: created.id,
            name: "LPM",
            machineType: "POLISHING",
            headCount: 16,
            abrasivesPerHead: 6,
          },
        ],
      });
      const owner = await tx.appUser.create({
        data: {
          factoryId: created.id,
          username,
          name,
          role: "owner",
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      });
      await tx.bootstrapLock.create({
        data: { id: "singleton", usedAt: new Date(), ownerUserId: owner.id },
      });
      return created;
    });

    const inventory = new InventoryService(prisma as never, { record: async () => undefined } as never);
    await inventory.ensureDefaultLocations(factory.id);
    console.log(`Created factory ${factory.name} (${factory.id})`);
    console.log(`Owner username: ${username}`);
    console.log("Owner must change the bootstrap password on first login.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
