import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { generateTemporaryPassword, hashPassword } from "@stoneos/auth";

/**
 * Lift a login lockout from the box, without going through the app.
 *
 * The lockout policy applies to every account, the owner's included. That is
 * deliberate — an owner's password is the most valuable one here — but it means a
 * suspended sole owner has nobody left in the app who can issue them new
 * credentials. This is the way back in, and it needs shell access to the server,
 * which is a fair bar for the one account that can do everything.
 *
 *   docker compose exec api npx tsx src/unlock.ts <username>
 *
 * Clears the failure counters, lifts any timed lock, un-suspends the account, and
 * prints a new temporary password that must be changed on first login. Pass
 * --keep-password to lift the lock without issuing a new one.
 */
async function main() {
  const args = process.argv.slice(2);
  const keepPassword = args.includes("--keep-password");
  const username = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

  if (!username) {
    throw new Error("Usage: npx tsx src/unlock.ts <username> [--keep-password]");
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.appUser.findUnique({ where: { username } });
    if (!user) throw new Error(`No account named ${username}`);

    const wasSuspended = user.suspendedAt !== null;
    const password = keepPassword ? null : generateTemporaryPassword();

    await prisma.$transaction([
      prisma.appUser.update({
        where: { id: user.id },
        data: {
          active: true,
          failedLoginCount: 0,
          lockoutCount: 0,
          lockedUntil: null,
          suspendedAt: null,
          ...(password
            ? {
                passwordHash: await hashPassword(password),
                mustChangePassword: true,
                tokenVersion: { increment: 1 },
              }
            : {}),
        },
      }),
      // Anything issued before the lockout dies here either way.
      prisma.authSession.deleteMany({ where: { userId: user.id } }),
    ]);

    await prisma.auditEvent.create({
      data: {
        factoryId: user.factoryId,
        actorId: user.id,
        action: "auth.unlock_cli",
        entityType: "app_user",
        entityId: user.id,
        payload: { username, wasSuspended, passwordReissued: password !== null },
      },
    });

    console.log(`Unlocked ${username}${wasSuspended ? " (was suspended)" : ""}`);
    if (password) {
      console.log(`Temporary password: ${password}`);
      console.log("It must be changed on first login. This is the only time it is shown.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
