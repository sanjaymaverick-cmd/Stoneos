import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@stoneos/auth";
import EmbeddedPostgres from "embedded-postgres";
import { AuthService } from "../src/modules/auth/auth.service";
import { UsersService } from "../src/modules/admin/users.service";
import { InventoryService } from "../src/modules/inventory/inventory.service";
import { ProductionService } from "../src/modules/production/production.service";
import { readFileSync } from "node:fs";
import { SalesService } from "../src/modules/sales/sales.service";
import { ExpensesService } from "../src/modules/expenses/expenses.service";
import { AuditService } from "../src/common/audit.service";
import { IdempotencyService } from "../src/common/idempotency";
import { FilesService } from "../src/modules/files/files.service";
import { BooksService } from "../src/modules/books/books.service";
import { KhataService } from "../src/modules/books/khata.service";
import { IntakeService } from "../src/modules/books/intake.service";
import { MusterService } from "../src/modules/muster/muster.service";
import { GstService } from "../src/modules/gst/gst.service";
import { CopilotService } from "../src/modules/books/copilot.service";
import { MaintenanceService } from "../src/modules/maintenance/maintenance.service";
import { ReportsService } from "../src/modules/reports/reports.service";
import { PartyReportService } from "../src/modules/reports/party-report.service";
import { DailyReportService } from "../src/modules/reports/daily-report.service";
import { LotsService } from "../src/modules/lots/lots.service";
import { ConsumablesController } from "../src/modules/production/consumables.controller";
import { INVENTORY_DATA_ROLES } from "@stoneos/contracts";
import type { AuthenticatedUser } from "../src/common/current-user";

const root = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(root, "..");

/**
 * The IST calendar month we are in right now, as YYYY-MM.
 *
 * Tests that create an invoice without passing a date get "now", so asking for a
 * hardcoded month only works during that month: the suite went red on 1 October
 * for invoices it had just written. Deriving it keeps the test about GST and not
 * about the calendar.
 *
 * Invoice dates default to today; explicit backdated invoices are tested separately
 * against fiscal numbering, ledger dates, and their original GST month.
 */
function currentFactoryDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function currentFactoryMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}


describe("postgres-backed workflows", () => {
  let pg: EmbeddedPostgres | undefined;
  let prisma: PrismaClient;
  let auth: AuthService;
  let users: UsersService;
  let inventory: InventoryService;
  let production: ProductionService;
  let sales: SalesService;
  let expenses: ExpensesService;
  let books: BooksService;
  let khata: KhataService;
  let intake: IntakeService;
  let muster: MusterService;
  let gst: GstService;
  let copilot: CopilotService;
  let reports: ReportsService;
  let dailyReports: DailyReportService;
  let lots: LotsService;
  let factoryId = "";
  let owner: AuthenticatedUser;

  before(async () => {
    const integrationUrl = process.env.STONEOS_INTEGRATION_DATABASE_URL;
    if (!integrationUrl) {
      pg = new EmbeddedPostgres({
        databaseDir: path.join(apiRoot, "data", "pg-test"),
        user: "stoneos",
        password: "stoneos_ci",
        port: 55432,
        persistent: false,
        // Postgres 18 Windows async I/O workers can survive shutdown and stall the next initdb.
        initdbFlags: ["--encoding=UTF8", "--locale=C", "--set=io_method=sync"],
      });
      await pg.initialise();
      await pg.start();
      await pg.createDatabase("stoneos");
      process.env.DATABASE_URL = "postgresql://stoneos:stoneos_ci@127.0.0.1:55432/stoneos";
    } else {
      process.env.DATABASE_URL = integrationUrl;
    }
    execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: "inherit",
    });
    prisma = new PrismaClient();
    const audit = new AuditService(prisma as never);
    auth = new AuthService(prisma as never, audit);
    users = new UsersService(prisma as never, audit);
    books = new BooksService(prisma as never);
    inventory = new InventoryService(prisma as never, audit, books);
    production = new ProductionService(prisma as never, audit);
    sales = new SalesService(prisma as never, audit, books);
    expenses = new ExpensesService(prisma as never, books);
    const files = new FilesService(prisma as never, audit);
    khata = new KhataService(prisma as never, files);
    intake = new IntakeService(prisma as never, files, expenses, sales, production, books);
    muster = new MusterService(prisma as never, books);
    gst = new GstService(prisma as never);
    copilot = new CopilotService(prisma as never, audit);
    reports = new ReportsService(prisma as never);
    dailyReports = new DailyReportService(prisma as never);
    lots = new LotsService(prisma as never, audit, books);

    await prisma.$executeRawUnsafe(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    const factory = await prisma.factory.create({ data: { name: "Test Factory" } });
    factoryId = factory.id;
    await inventory.ensureDefaultLocations(factoryId);
    await prisma.machine.createMany({
      data: [
        { factoryId, name: "B-21", machineType: "CUTTING", bladeCount: 21 },
        { factoryId, name: "LPM", machineType: "POLISHING", headCount: 16, abrasivesPerHead: 6 },
      ],
    });
    const row = await prisma.appUser.create({
      data: {
        factoryId,
        username: "owner",
        name: "Owner",
        role: "owner",
        passwordHash: await hashPassword("ChangeMeNow!12"),
        mustChangePassword: false,
      },
    });
    owner = {
      id: row.id,
      username: row.username,
      name: row.name,
      email: null,
      role: "owner",
      factoryId,
      mustChangePassword: false,
      active: true,
      sessionId: "test",
    };
  });

  after(async () => {
    await prisma?.$disconnect();
    await pg?.stop();
  });

  it("locks a login for 5 minutes at 10 wrong passwords, then suspends it 5 more in", async () => {
    const { asOwner } = await staffFactory("lockout");
    const issued = await users.provision(asOwner, { username: "lk-operator", role: "operator" });
    const good = issued.password!;

    const wrong = () => auth.login("lk-operator", "NotThePassword!1");

    // 1. Nine wrong passwords count but change nothing — a bad morning is not a lockout.
    for (let i = 0; i < 9; i += 1) await assert.rejects(wrong, /Invalid username or password/i);
    assert.equal(
      (await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } })).failedLoginCount,
      9,
    );
    // The right password still works, and getting in wipes the slate.
    await auth.login("lk-operator", good);
    assert.equal(
      (await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } })).failedLoginCount,
      0,
      "a successful login must reset the counter",
    );

    // 2. The tenth consecutive failure locks the account for five minutes.
    for (let i = 0; i < 10; i += 1) await assert.rejects(wrong, /Invalid username or password/i);
    const locked = await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } });
    assert.ok(locked.lockedUntil, "ten failures must set a lock");
    assert.equal(locked.active, true, "a timed lock is not a suspension");
    const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
    assert.ok(minutes > 4 && minutes <= 5, `lock should be ~5 minutes, got ${minutes}`);

    // The correct password is refused while the lock holds, and says why.
    await assert.rejects(() => auth.login("lk-operator", good), /locked for another/i);

    // A wrong password during the lock must NOT count. Otherwise the cooldown would be
    // the fastest route to suspension and one burst could burn any account down.
    for (let i = 0; i < 20; i += 1) await assert.rejects(wrong, /Invalid username or password/i);
    const during = await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } });
    assert.equal(during.failedLoginCount, 0, "failures during a lock must not accumulate");
    assert.equal(during.active, true, "hammering during a lock must not suspend");

    // 3. Once the lock expires, five more failures suspend the account outright.
    await prisma.appUser.update({
      where: { id: issued.user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await auth.login("lk-operator", good); // the lock has passed, so this gets in...
    await prisma.appUser.update({
      where: { id: issued.user.id },
      data: { lockoutCount: 1, failedLoginCount: 0 }, // ...but pin the second round for the test
    });
    for (let i = 0; i < 5; i += 1) await assert.rejects(wrong, /Invalid username or password/i);
    const suspended = await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } });
    assert.equal(suspended.active, false, "five more failures must suspend");
    assert.ok(suspended.suspendedAt, "and record that it was a suspension, not a revocation");
    assert.equal(
      await prisma.authSession.count({ where: { userId: issued.user.id } }),
      0,
      "suspension must kill live sessions",
    );

    // The right password now names the remedy instead of a generic refusal, because
    // whoever typed it has proved they are the account holder.
    await assert.rejects(() => auth.login("lk-operator", good), /owner must issue new credentials/i);
    // A wrong password still says nothing.
    await assert.rejects(wrong, /Invalid username or password/i);

    // 4. Re-issuing the username is refused and names the real cause.
    await assert.rejects(
      () => users.provision(asOwner, { username: "lk-operator", role: "operator" }),
      /suspended after repeated failed logins/i,
    );

    // 5. The owner issuing new credentials is the way back, and it clears the slate.
    const back = await users.reactivate(asOwner, issued.user.id);
    const restored = await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } });
    assert.equal(restored.suspendedAt, null);
    assert.equal(restored.lockoutCount, 0);
    assert.equal(restored.failedLoginCount, 0);
    assert.equal(restored.lockedUntil, null);
    const fresh = await auth.login("lk-operator", back.password!);
    assert.equal(fresh.user.mustChangePassword, true);
    // The password that was live before the suspension stays dead.
    await assert.rejects(() => auth.login("lk-operator", good), /Invalid username or password/i);

    const actions = (
      await prisma.auditEvent.findMany({
        where: { entityId: issued.user.id },
        select: { action: true },
      })
    ).map((a) => a.action);
    assert.ok(actions.includes("auth.locked"));
    assert.ok(actions.includes("auth.suspended"));
  });

  it("lifts a timed lock when the owner resets the password", async () => {
    const { asOwner } = await staffFactory("lockreset");
    const issued = await users.provision(asOwner, { username: "lr-sales", role: "supervisor" });
    for (let i = 0; i < 10; i += 1) {
      await assert.rejects(() => auth.login("lr-sales", "Wrong!12345678"));
    }
    assert.ok((await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } })).lockedUntil);

    // A locked-out employee should not have to wait out the clock as well as take a
    // new password from the owner.
    const reset = await users.resetPassword(asOwner, issued.user.id);
    const after = await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } });
    assert.equal(after.lockedUntil, null);
    assert.equal(after.lockoutCount, 0);
    assert.equal(after.failedLoginCount, 0);
    await auth.login("lr-sales", reset.password);
  });

  it("logs in with hashed passwords and revokes sessions on password change", async () => {
    const login = await auth.login("owner", "ChangeMeNow!12");
    assert.ok(login.token);
    const changed = await auth.changePassword(owner, "ChangeMeNow!12", "Even-Stronger!99");
    assert.ok(changed.token);
    await assert.rejects(() => auth.login("owner", "ChangeMeNow!12"));
  });

  it("disables an employee for good: the old password dies with the account", async () => {
    const { factory, asOwner } = await staffFactory("lifecycle");

    // 1. The owner issues a credential. The password comes back exactly once.
    const issued = await users.provision(asOwner, { username: "lc-operator", role: "operator" });
    assert.equal(issued.created, true);
    assert.ok(issued.password, "a new account must return its password once");
    assert.equal(issued.user.mustChangePassword, true);
    const firstPassword = issued.password!;

    // 2. They log in and are forced to change it before anything else.
    const firstLogin = await auth.login("lc-operator", firstPassword);
    assert.equal(firstLogin.user.mustChangePassword, true);
    await auth.changePassword(
      { ...asOwner, id: issued.user.id, role: "operator" },
      firstPassword,
      "OperatorChosen!2026",
    );
    const chosen = await auth.login("lc-operator", "OperatorChosen!2026");
    assert.equal(chosen.user.mustChangePassword, false);
    // The temporary password is dead the moment it is replaced.
    await assert.rejects(() => auth.login("lc-operator", firstPassword), /Invalid username or password/i);

    // 3. The owner disables them. Access stops immediately and every session dies.
    await users.revoke(asOwner, issued.user.id);
    assert.equal(
      await prisma.authSession.count({ where: { userId: issued.user.id } }),
      0,
      "revoking must kill live sessions, not just block the next login",
    );
    await assert.rejects(
      () => auth.login("lc-operator", "OperatorChosen!2026"),
      /Invalid username or password/i,
    );

    // 4. Re-issuing the same username must NOT quietly bring them back. This was
    //    the hole: it set active=true, kept the old password working, and recorded
    //    only a role change.
    await assert.rejects(
      () => users.provision(asOwner, { username: "lc-operator", role: "operator" }),
      /disabled/i,
    );
    const stillOff = await prisma.appUser.findUniqueOrThrow({ where: { id: issued.user.id } });
    assert.equal(stillOff.active, false, "a refused provision must not have reactivated them");

    // 5. Reactivation is deliberate and issues a NEW password. The old one stays dead,
    //    so anything written down or shared while they were gone does not come back.
    const back = await users.reactivate(asOwner, issued.user.id);
    assert.equal(back.reactivated, true);
    assert.ok(back.password);
    assert.notEqual(back.password, firstPassword);
    await assert.rejects(
      () => auth.login("lc-operator", "OperatorChosen!2026"),
      /Invalid username or password/i,
    );
    const returned = await auth.login("lc-operator", back.password!);
    assert.equal(returned.user.mustChangePassword, true, "and they must choose a new one again");

    // Both acts are on the audit trail under their own names.
    const actions = (
      await prisma.auditEvent.findMany({
        where: { factoryId: factory.id, entityId: issued.user.id },
        select: { action: true },
      })
    ).map((a) => a.action);
    assert.ok(actions.includes("user.revoke"));
    assert.ok(actions.includes("user.reactivate"));
  });

  it("lets a temporary password do nothing but replace itself", () => {
    // Reads used to be allowed through, so a credential slip opened the CEO board,
    // outstanding AR and the CSV exports before the password was ever changed.
    const onTemp = (path: string) =>
      path.endsWith("/auth/change-password") ||
      path.endsWith("/auth/logout") ||
      path.endsWith("/auth/me");
    assert.equal(onTemp("/api/v1/auth/change-password"), true);
    assert.equal(onTemp("/api/v1/auth/me"), true);
    assert.equal(onTemp("/api/v1/auth/logout"), true);
    assert.equal(onTemp("/api/v1/reports/ceo"), false);
    assert.equal(onTemp("/api/v1/books/outstanding"), false);
    assert.equal(onTemp("/api/v1/reports/export/slabs.csv"), false);
  });

  it("keeps the chain of command: only the owner hands out roles, and nobody edits a peer", async () => {
    const { asOwner } = await staffFactory("hierarchy");

    const manager = await legacyAccount(asOwner, { username: "h-mgr", role: "manager", name: "Mgr" });
    const peerManager = await legacyAccount(asOwner, { username: "h-mgr2", role: "manager" });
    const admin = await legacyAccount(asOwner, { username: "h-admin", role: "admin" });
    const operator = await users.provision(asOwner, { username: "h-operator", role: "operator" });
    const accountant = await legacyAccount(asOwner, { username: "h-accounts", role: "accountant" });
    const asManager: AuthenticatedUser = {
      ...asOwner,
      id: manager.user.id,
      role: "manager",
      username: "h-mgr",
    };

    // Handing out a rank is the owner's alone — not creating an account, not changing
    // an existing one's role, not even for a role far below the manager's own.
    await assert.rejects(
      () => users.provision(asManager, { username: "h-newhand", role: "operator" }),
      /only the owner can assign or change a role/i,
    );
    await assert.rejects(
      () => users.provision(asManager, { username: "h-operator", role: "supervisor" }),
      /only the owner can assign or change a role/i,
    );
    await assert.rejects(
      () => users.provision(asManager, { username: "h-otherowner", role: "owner" }),
      /only the owner can assign or change a role/i,
    );
    assert.equal(
      await prisma.appUser.count({ where: { username: "h-newhand" } }),
      0,
      "a refused provision must not have created the account",
    );
    assert.equal(
      (await prisma.appUser.findUniqueOrThrow({ where: { id: operator.user.id } })).role,
      "operator",
      "a refused role change must leave the role alone",
    );

    // A manager still runs the people below them: reset, disable, bring back.
    const reset = await users.resetPassword(asManager, operator.user.id);
    assert.ok(reset.password);
    await users.revoke(asManager, accountant.user.id);
    const restored = await users.reactivate(asManager, accountant.user.id);
    assert.equal(restored.reactivated, true);
    // An admin ranks below a manager, so that reach extends there too.
    await users.revoke(asManager, admin.user.id);
    await users.reactivate(asManager, admin.user.id);

    // But never sideways or upward. A disagreement between two managers cannot be
    // settled by one of them switching the other off.
    await assert.rejects(
      () => users.revoke(asManager, peerManager.user.id),
      /a manager cannot revoke a manager account/i,
    );
    await assert.rejects(
      () => users.resetPassword(asManager, peerManager.user.id),
      /a manager cannot reset a manager account/i,
    );
    await assert.rejects(
      () => users.revoke(asManager, asOwner.id),
      /only an owner can revoke an owner account/i,
    );
    assert.equal(
      (await prisma.appUser.findUniqueOrThrow({ where: { id: peerManager.user.id } })).active,
      true,
      "the peer manager must still be enabled",
    );

    // An admin manages nobody at all — the role is a desk, not a rung.
    const asAdmin: AuthenticatedUser = {
      ...asOwner,
      id: admin.user.id,
      role: "admin",
      username: "h-admin",
    };
    await assert.rejects(
      () => users.revoke(asAdmin, operator.user.id),
      /only owners and managers can manage users/i,
    );

    // The owner reaches all of them.
    await users.revoke(asOwner, peerManager.user.id);
    assert.equal(
      (await prisma.appUser.findUniqueOrThrow({ where: { id: peerManager.user.id } })).active,
      false,
    );
  });

  it("isolates raw blocks across factories", async () => {
    const other = await prisma.factory.create({ data: { name: "Other" } });
    await inventory.ensureDefaultLocations(other.id);
    await prisma.rawBlock.create({
      data: { factoryId: other.id, serialNumber: "X1", varietyName: "Black" },
    });
    const mine = await inventory.rawBlocks(factoryId);
    assert.equal(mine.some((b) => b.serialNumber === "X1"), false);
  });

  it("receives a block, cuts it, and does not stock damaged slabs", async () => {
    const received = (await inventory.receiveBlock(owner, {
      serialNumber: "V101",
      varietyName: "Kashmir White",
      clientOpId: "op-block-1",
      weightTons: 2,
      actualAmountPaid: 100000,
    })) as { block: { id: string } };
    const machine = await prisma.machine.findFirst({ where: { factoryId, name: "B-21" } });
    const session = await production.startCutting(owner, {
      rawBlockId: received.block.id,
      machineId: machine!.id,
    });
    const done = await production.completeCutting(owner, session.id, {
      totalSlabsCut: 10,
      finalGoodSlabCount: 8,
      lengthFt: 8,
      widthFt: 4,
    });
    assert.equal(done.slabs.length, 8);
    assert.equal(done.damaged, 2);
    assert.equal(done.damagedCost, 20000);
  });

  it("opening approval requires a different user and then goes live", async () => {
    const manager = await legacyAccount(owner, { username: "mgr1", role: "manager", name: "Mgr" });
    const asManager: AuthenticatedUser = {
      ...owner,
      id: manager.user.id,
      role: "manager",
      username: "mgr1",
    };
    const snapshot = await inventory.startOpeningCount(asManager);
    await inventory.addOpeningLine(asManager, snapshot.id, "RAW_BLOCK", {
      serialNumber: "OPEN-1",
      varietyName: "Tan Brown",
      weightTons: "18",
    });
    await inventory.submitOpening(asManager, snapshot.id);
    await assert.rejects(() => inventory.approveOpening(asManager, snapshot.id));
    const approved = await inventory.approveOpening(owner, snapshot.id);
    assert.equal(approved.live, true);
    const factory = await prisma.factory.findUnique({ where: { id: factoryId } });
    assert.equal(factory?.operatingStatus, "LIVE");
  });

  it("is idempotent on invoice retries and rejects overpay", async () => {
    const customer = await sales.createCustomer(owner, "Acme");
    const finished = await prisma.inventoryLocation.findFirst({
      where: { factoryId, code: "FINISHED_STOCK" },
    });
    const slab = await prisma.slab.findFirst({ where: { factoryId } });
    await prisma.slab.update({ where: { id: slab!.id }, data: { locationId: finished!.id } });
    const order = (await sales.createOrder(owner, {
      customerId: customer.id,
      orderDate: "2026-09-05",
      clientOpId: "order-1",
      lines: [{ slabId: slab?.id, quantitySqft: 32, rate: 100 }],
    })) as { id: string };
    const first = await sales.invoice(owner, order.id, "inv-1");
    const retry = await sales.invoice(owner, order.id, "inv-1");
    assert.equal(first.id, (retry as { id: string }).id);
    assert.match(first.invoiceNumber, /^INV-\d{4}-\d{5}$/);
    await sales.pay(owner, first.id, {
      amount: 1000,
      method: "cash",
      paidAt: "2026-09-05",
      clientOpId: "pay-1",
    });
    await assert.rejects(() =>
      sales.pay(owner, first.id, {
        amount: 3000,
        method: "cash",
        paidAt: "2026-09-05",
        clientOpId: "pay-2",
      }),
    );
  });

  it("retries the same goods-receipt clientOpId without a second block", async () => {
    const first = (await inventory.receiveBlock(owner, {
      serialNumber: "V202",
      varietyName: "Steel Grey",
      weightTons: 18,
      clientOpId: "receipt-dup",
    })) as { block: { id: string } };
    const retry = (await inventory.receiveBlock(owner, {
      serialNumber: "V202",
      varietyName: "Steel Grey",
      weightTons: 18,
      clientOpId: "receipt-dup",
    })) as { block: { id: string } };
    assert.equal(first.block.id, retry.block.id);
    const count = await prisma.rawBlock.count({ where: { factoryId, serialNumber: "V202" } });
    assert.equal(count, 1);
  });

  it("reverses a goods receipt and refuses a second reverse", async () => {
    const received = (await inventory.receiveBlock(owner, {
      serialNumber: "V303",
      varietyName: "Tan Brown",
      weightTons: 18,
      clientOpId: "receipt-rev",
    })) as { block: { id: string } };
    const movement = await prisma.inventoryMovement.findFirst({
      where: { factoryId, rawBlockId: received.block.id, movementType: "GOODS_RECEIPT" },
    });
    assert.ok(movement);
    const first = (await inventory.reverseMovement(owner, movement!.id, "mistype", "rev-1")) as {
      reversed: boolean;
    };
    assert.equal(first.reversed, true);
    const block = await prisma.rawBlock.findUnique({ where: { id: received.block.id } });
    assert.equal(block?.currentStatus, "voided");
    const retry = (await inventory.reverseMovement(owner, movement!.id, "mistype", "rev-1")) as {
      reversed: boolean;
    };
    assert.equal(retry.reversed, true);
    await assert.rejects(() => inventory.reverseMovement(owner, movement!.id, "again", "rev-2"));
  });

  it("requires vehicleId for vehicle expenses and rejects foreign-factory vehicles", async () => {
    await assert.rejects(() =>
      expenses.create(owner, {
        category: "vehicle",
        amount: 500,
        expenseDate: "2026-09-05",
      }),
    );
    const vehicle = await expenses.createVehicle(owner, "Isuzu");
    const other = await prisma.factory.create({ data: { name: "Other2" } });
    const foreign = await prisma.vehicle.create({ data: { factoryId: other.id, name: "Stolen" } });
    await assert.rejects(() =>
      expenses.create(owner, {
        category: "vehicle",
        amount: 500,
        expenseDate: "2026-09-05",
        vehicleId: foreign.id,
      }),
    );
    const ok = await expenses.create(owner, {
      category: "vehicle",
      amount: 500,
      expenseDate: "2026-09-05",
      vehicleId: vehicle.id,
      clientOpId: "exp-1",
    });
    assert.equal(Number(ok.amount), 500);
  });

  // Existing legacy accounts remain usable; they can no longer be issued from the UI/API.
  async function legacyAccount(actor: AuthenticatedUser, input: {username:string;role:string;name?:string}) {
    const issued=await users.provision(actor,{...input,role:"operator"});
    const row=await prisma.appUser.update({where:{id:issued.user.id},data:{role:input.role}});
    return {...issued,user:{...issued.user,role:row.role}};
  }

  async function staffFactory(label: string) {
    const factory = await prisma.factory.create({ data: { name: label } });
    await inventory.ensureDefaultLocations(factory.id);
    await prisma.machine.createMany({
      data: [
        { factoryId: factory.id, name: "B-21", machineType: "CUTTING", bladeCount: 21 },
        { factoryId: factory.id, name: "LPM", machineType: "POLISHING", headCount: 16, abrasivesPerHead: 6 },
      ],
    });
    const suffix = `${label}-${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9-]/g, "").slice(0, 24);
    const ownerRow = await prisma.appUser.create({
      data: {
        factoryId: factory.id,
        username: `o-${suffix}`,
        name: "Owner",
        role: "owner",
        passwordHash: await hashPassword("ChangeMeNow!12"),
        mustChangePassword: false,
      },
    });
    const mgrRow = await prisma.appUser.create({
      data: {
        factoryId: factory.id,
        username: `m-${suffix}`,
        name: "Mgr",
        role: "manager",
        passwordHash: await hashPassword("ChangeMeNow!12"),
        mustChangePassword: false,
      },
    });
    const asOwner: AuthenticatedUser = {
      ...owner,
      id: ownerRow.id,
      factoryId: factory.id,
      username: ownerRow.username,
      role: "owner",
    };
    const asManager: AuthenticatedUser = {
      ...owner,
      id: mgrRow.id,
      factoryId: factory.id,
      username: mgrRow.username,
      role: "manager",
    };
    return { factory, asOwner, asManager };
  }

  it("rejects the line enterer from approving opening, including owner-start", async () => {
    const { factory, asOwner, asManager } = await staffFactory("sod");
    const snapshot = await inventory.startOpeningCount(asOwner);
    await inventory.addOpeningLine(asOwner, snapshot.id, "RAW_BLOCK", {
      serialNumber: "SOD-1",
      varietyName: "Tan Brown",
      weightTons: "2.5",
      invoicedAmount: "12000",
    });
    await inventory.submitOpening(asOwner, snapshot.id);
    await assert.rejects(() => inventory.approveOpening(asOwner, snapshot.id), /cannot approve/i);
    const approved = await inventory.approveOpening(asManager, snapshot.id);
    assert.equal(approved.live, true);
    const block = await prisma.rawBlock.findFirst({ where: { factoryId: factory.id, serialNumber: "SOD-1" } });
    assert.equal(Number(block?.weightTons), 2.5);
    assert.equal(Number(block?.invoicedAmount), 12000);
  });

  it("allows the starter to approve when a different user entered the lines", async () => {
    const { factory, asOwner, asManager } = await staffFactory("sod2");
    const snapshot = await inventory.startOpeningCount(asOwner);
    await inventory.addOpeningLine(asManager, snapshot.id, "RAW_BLOCK", {
      serialNumber: "SOD-2",
      varietyName: "Black",
      weightTons: "1",
    });
    await inventory.submitOpening(asManager, snapshot.id);
    const approved = await inventory.approveOpening(asOwner, snapshot.id);
    assert.equal(approved.live, true);
    const live = await prisma.factory.findUnique({ where: { id: factory.id } });
    assert.equal(live?.operatingStatus, "LIVE");
  });

  it("approves a large opening count without a transaction timeout", async () => {
    const { factory, asOwner, asManager } = await staffFactory("yard");
    const snapshot = await inventory.startOpeningCount(asManager);
    await prisma.openingInventoryLine.createMany({
      data: Array.from({ length: 150 }, (_, i) => ({
        snapshotId: snapshot.id,
        kind: "RAW_BLOCK" as const,
        enteredById: asManager.id,
        payload: {
          serialNumber: `YARD-${i}`,
          varietyName: "Grey",
          weightTons: "1.5",
          invoicedAmount: "5000",
        },
      })),
    });
    await inventory.submitOpening(asManager, snapshot.id);
    const approved = await inventory.approveOpening(asOwner, snapshot.id);
    assert.equal(approved.live, true);
    const count = await prisma.rawBlock.count({ where: { factoryId: factory.id } });
    assert.equal(count, 150);
    const sample = await prisma.rawBlock.findFirst({
      where: { factoryId: factory.id, serialNumber: "YARD-0" },
    });
    assert.equal(Number(sample?.weightTons), 1.5);
  });

  it("does not make grinding completion sellable and refuses sold slabs", async () => {
    const { factory, asOwner } = await staffFactory("lpm");
    const unpolished = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "UNPOLISHED_STOCK" },
    });
    const finished = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "FINISHED_STOCK" },
    });
    const slab = await prisma.slab.create({
      data: {
        factoryId: factory.id,
        slabSerial: "G-1",
        varietyName: "White",
        locationId: unpolished!.id,
      },
    });
    const machine = await prisma.machine.findFirst({ where: { factoryId: factory.id, name: "LPM" } });
    const grind = await production.startPolishing(asOwner, {
      machineId: machine!.id,
      processType: "GRINDING",
      slabIds: [slab.id],
    });
    const grindDone = await production.completePolishing(asOwner, grind.id);
    assert.equal(grindDone.sellable, false);
    const afterGrind = await prisma.slab.findUnique({ where: { id: slab.id } });
    assert.equal(afterGrind?.locationId, unpolished!.id);
    assert.equal(afterGrind?.salesStatus, "in_stock");

    const polish = await production.startPolishing(asOwner, {
      machineId: machine!.id,
      processType: "POLISHING",
      slabIds: [slab.id],
    });
    const polishDone = await production.completePolishing(asOwner, polish.id);
    assert.equal(polishDone.sellable, true);
    const afterPolish = await prisma.slab.findUnique({ where: { id: slab.id } });
    assert.equal(afterPolish?.locationId, finished!.id);

    const sold = await prisma.slab.create({
      data: {
        factoryId: factory.id,
        slabSerial: "SOLD-1",
        varietyName: "White",
        salesStatus: "sold",
        locationId: finished!.id,
      },
    });
    const blocked = await production.startPolishing(asOwner, {
      machineId: machine!.id,
      processType: "POLISHING",
      slabIds: [sold.id],
    });
    await assert.rejects(() => production.completePolishing(asOwner, blocked.id), /sold|reserved|voided/i);
  });

  it("reports the CEO recovery ratio below the benchmark when the yard actually under-recovers", async () => {
    const { factory, asOwner } = await staffFactory("recov");
    const machine = await prisma.machine.findFirst({ where: { factoryId: factory.id, name: "B-21" } });
    const lpm = await prisma.machine.findFirst({ where: { factoryId: factory.id, name: "LPM" } });
    const customer = await sales.createCustomer(asOwner, "Recovery Co");

    // Cut a block, polish every slab so it is sellable, and sell the lot.
    const sellBlock = async (serial: string, tons: number, slabCount: number, sellCount: number, sqftEach: number) => {
      const received = (await inventory.receiveBlock(asOwner, {
        serialNumber: serial,
        varietyName: "Kashmir White",
        clientOpId: `${serial}-recv`,
        weightTons: tons,
        actualAmountPaid: 100000,
      })) as { block: { id: string } };
      const cut = await production.startCutting(asOwner, {
        rawBlockId: received.block.id,
        machineId: machine!.id,
      });
      const done = await production.completeCutting(asOwner, cut.id, {
        totalSlabsCut: slabCount,
        finalGoodSlabCount: slabCount,
        lengthFt: 8,
        widthFt: 4,
      });
      const slabIds = done.slabs.map((slab) => slab.id);
      const polish = await production.startPolishing(asOwner, {
        machineId: lpm!.id,
        processType: "POLISHING",
        slabIds,
      });
      await production.completePolishing(asOwner, polish.id);
      const order = await sales.createOrder(asOwner, {
        customerId: customer.id,
        orderDate: "2026-09-12",
        clientOpId: `${serial}-order`,
        lines: slabIds
          .slice(0, sellCount)
          .map((slabId) => ({ slabId, quantitySqft: sqftEach, rate: 100 })),
      });
      // Reservation is still stock in the yard. Recovery waits for dispatch of every piece.
      assert.equal((await reports.ceoBrief(factory.id)).blockRecoveries.some(r=>r.soldSqft>0 && !r.settled),false);
      await sales.pack(asOwner,(order as {id:string}).id,slabIds.slice(0,sellCount));
      await sales.dispatch(asOwner,(order as {id:string}).id,slabIds.slice(0,sellCount),{clientOpId:`${serial}-dispatch`});
      return slabIds;
    };

    // 20 tons in, 1000 sqft committed out. True recovery is 50 sqft/ton, not 105.
    await sellBlock("RECOV-1", 20, 10, 10, 100);

    const brief = await reports.ceoBrief(factory.id);
    assert.equal(brief.recoveryRatio, 50);
    assert.equal(brief.recoveryBasis.settledBlocks, 1);
    assert.equal(brief.recoveryBasis.openBlocks, 0);
    assert.equal(brief.recoveryBasis.tons, 20, "the whole block tonnage must be judged");
    const below = brief.exceptions.find((e) => e.code === "RECOVERY_BELOW_BENCHMARK");
    assert.ok(below, "an under-recovering yard must raise RECOVERY_BELOW_BENCHMARK");
    assert.equal(below?.severity, "critical");
    assert.match(brief.narrative, /50\.0 sqft\/ton/);

    // A block still holding stock is excluded outright, never folded in at a discount.
    await sellBlock("RECOV-2", 30, 5, 2, 400);
    const withOpen = await reports.ceoBrief(factory.id);
    assert.equal(withOpen.recoveryRatio, 50, "an open block must not move the settled ratio");
    assert.equal(withOpen.recoveryBasis.settledBlocks, 1);
    assert.equal(withOpen.recoveryBasis.openBlocks, 1);
    assert.match(withOpen.narrative, /1 block\(s\) still holding stock are excluded/);
  });

  it("refuses to order a freshly cut, unpolished slab", async () => {
    const { factory, asOwner } = await staffFactory("unpol");
    const unpolished = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "UNPOLISHED_STOCK" },
    });
    const slab = await prisma.slab.create({
      data: {
        factoryId: factory.id,
        slabSerial: "UNPOL-1",
        varietyName: "White",
        locationId: unpolished!.id,
      },
    });
    const customer = await sales.createCustomer(asOwner, "Unpolished Co");
    await assert.rejects(
      () =>
        sales.createOrder(asOwner, {
          customerId: customer.id,
          orderDate: "2026-09-12",
          clientOpId: "unpol-order",
          lines: [{ slabId: slab.id, quantitySqft: 32, rate: 100 }],
        }),
      /not been polished/i,
    );
  });

  it("derives DPR good-slab totals from slab rows, not typed day-log counts", async () => {
    const { factory, asOwner } = await staffFactory("dpr");
    const received = (await inventory.receiveBlock(asOwner, {
      serialNumber: "DPR-1",
      varietyName: "Kashmir White",
      clientOpId: "dpr-block",
      weightTons: 2,
      actualAmountPaid: 100000,
    })) as { block: { id: string } };
    const machine = await prisma.machine.findFirst({ where: { factoryId: factory.id, name: "B-21" } });
    const session = await production.startCutting(asOwner, {
      rawBlockId: received.block.id,
      machineId: machine!.id,
    });
    await production.logCuttingDay(asOwner, session.id, { slabsProducedCount: 99, runtimeHours: 6 });
    const done = await production.completeCutting(asOwner, session.id, {
      totalSlabsCut: 6,
      finalGoodSlabCount: 4,
      lengthFt: 8,
      widthFt: 4,
    });
    assert.equal(done.slabs.length, 4);
    const dpr = await production.derivedDpr(
      factory.id,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2030-01-01T00:00:00Z"),
    );
    assert.equal(dpr.slabsCut, 4);
  });

  it("issues distinct FY invoice numbers under concurrent invoice()", async () => {
    const { asOwner } = await staffFactory("inv");
    const customer = await sales.createCustomer(asOwner, "Concurrent Co");
    const a = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-06",
      clientOpId: "conc-order-a",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    const b = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-06",
      clientOpId: "conc-order-b",
      lines: [{ quantitySqft: 8, rate: 100 }],
    })) as { id: string };
    const [ia, ib] = await Promise.all([
      sales.invoice(asOwner, a.id, "conc-inv-a"),
      sales.invoice(asOwner, b.id, "conc-inv-b"),
    ]);
    assert.match(ia.invoiceNumber, /^INV-\d{4}-\d{5}$/);
    assert.match(ib.invoiceNumber, /^INV-\d{4}-\d{5}$/);
    assert.notEqual(ia.invoiceNumber, ib.invoiceNumber);
  });

  it("blocks a raw payment insert that would exceed the invoice even without the service lock", async () => {
    const { factory, asOwner } = await staffFactory("paycap");
    const customer = await sales.createCustomer(asOwner, "Cap Co");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-06",
      clientOpId: "cap-order",
      lines: [{ quantitySqft: 1, rate: 10 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "cap-inv");
    await assert.rejects(() =>
      prisma.payment.create({
        data: {
          factoryId: factory.id,
          invoiceId: invoice.id,
          amount: 50,
          method: "cash",
          paidAt: new Date("2026-09-06"),
          idempotencyKey: "cap-raw",
        },
      }),
    );
  });

  it("credits AR when returning slabs on an invoiced order", async () => {
    const { factory, asOwner } = await staffFactory("ret");
    const slab = await prisma.slab.create({
      data: { factoryId: factory.id, slabSerial: "RET-1", varietyName: "White" },
    });
    const customer = await sales.createCustomer(asOwner, "Return Co");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-06",
      clientOpId: "ret-order",
      lines: [{ slabId: slab.id, quantitySqft: 32, rate: 100 }],
    })) as { id: string };
    await sales.invoice(asOwner, order.id, "ret-inv");
    const result = await sales.returnSlabs(asOwner, order.id, [slab.id], "wrong shade");
    assert.ok(result.creditNote);
    assert.equal(Number(result.creditNote?.amount), 3200);
    assert.match(result.creditNote!.creditNoteNumber, /^CN-\d{4}-\d{5}$/);
    const back = await prisma.slab.findUnique({ where: { id: slab.id } });
    assert.equal(back?.salesStatus, "in_stock");
    const standing = await prisma.invoice.findFirst({ where: { salesOrderId: order.id } });
    assert.ok(standing);
  });

  it("returns 409 when a cutting day-log baseVersion does not match", async () => {
    const { asOwner } = await staffFactory("ver");
    const received = (await inventory.receiveBlock(asOwner, {
      serialNumber: "VER-1",
      varietyName: "Grey",
      weightTons: 18,
      clientOpId: "ver-block",
    })) as { block: { id: string } };
    const machine = await prisma.machine.findFirst({
      where: { factoryId: asOwner.factoryId, name: "B-21" },
    });
    const session = await production.startCutting(asOwner, {
      rawBlockId: received.block.id,
      machineId: machine!.id,
    });
    await production.logCuttingDay(asOwner, session.id, { runtimeHours: 1 });
    await production.logCuttingDay(asOwner, session.id, { runtimeHours: 2, baseVersion: 0 });
    await assert.rejects(
      () => production.logCuttingDay(asOwner, session.id, { runtimeHours: 3, baseVersion: 0 }),
      (err: unknown) => {
        const e = err as { status?: number; response?: { code?: string } };
        const body = (err as { getResponse?: () => { code?: string } }).getResponse?.();
        return e.status === 409 || body?.code === "VERSION_CONFLICT" || String(err).includes("VERSION_CONFLICT") || String(err).includes("Conflict");
      },
    );
  });

  it("pack moves slabs to PACKING so the list actually ships stock", async () => {
    const { factory, asOwner } = await staffFactory("pack");
    const finished = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "FINISHED_STOCK" },
    });
    const packing = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "PACKING" },
    });
    const slab = await prisma.slab.create({
      data: {
        factoryId: factory.id,
        slabSerial: "PACK-1",
        varietyName: "White",
        locationId: finished!.id,
      },
    });
    const customer = await sales.createCustomer(asOwner, "Pack Co");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-06",
      clientOpId: "pack-order",
      lines: [{ slabId: slab.id, quantitySqft: 32, rate: 100 }],
    })) as { id: string };
    const before = await prisma.slab.findUnique({ where: { id: slab.id } });
    await sales.pack(asOwner, order.id, [slab.id]);
    const after = await prisma.slab.findUnique({ where: { id: slab.id } });
    assert.equal(after?.salesStatus, before?.salesStatus);
    assert.equal(after?.locationId, packing!.id);
    const packingMoves = await prisma.inventoryMovement.count({
      where: { factoryId: factory.id, movementType: "PACKING" },
    });
    assert.equal(packingMoves, 1);
  });

  it("posts one balanced voucher per invoice, pay, and expense, and retries are no-ops", async () => {
    const { factory, asOwner } = await staffFactory("voucher");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    const customer = await sales.createCustomer(asOwner, "Books Co");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-12",
      clientOpId: "books-order",
      lines: [{ quantitySqft: 32, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "books-inv");
    const retryInv = await sales.invoice(asOwner, order.id, "books-inv");
    assert.equal(invoice.id, (retryInv as { id: string }).id);
    await sales.pay(asOwner, invoice.id, {
      amount: 1000,
      method: "cash",
      paidAt: "2026-09-12",
      clientOpId: "books-pay",
    });
    const retryPay = await sales.pay(asOwner, invoice.id, {
      amount: 1000,
      method: "cash",
      paidAt: "2026-09-12",
      clientOpId: "books-pay",
    });
    assert.equal((retryPay as { id: string }).id, (await prisma.payment.findFirst({ where: { factoryId: factory.id } }))!.id);
    await expenses.create(asOwner, {
      category: "diesel",
      amount: 500,
      expenseDate: "2026-09-12",
      clientOpId: "books-exp",
    });
    await expenses.create(asOwner, {
      category: "diesel",
      amount: 500,
      expenseDate: "2026-09-12",
      clientOpId: "books-exp",
    });
    const vouchers = await prisma.voucher.findMany({
      where: { factoryId: factory.id },
      include: { lines: { include: { ledger: true } } },
    });
    assert.equal(vouchers.length, 3);
    for (const v of vouchers) {
      const debit = v.lines.reduce((s, l) => s + l.debit, 0);
      const credit = v.lines.reduce((s, l) => s + l.credit, 0);
      assert.equal(debit, credit);
    }
    const salesV = vouchers.find((v) => v.source === "sales_invoice");
    // 32 sqft at 100 is 3200 taxable; a Rajasthan buyer of a Rajasthan factory pays
    // 9% CGST + 9% SGST on top, so AR carries 3776 and sales carries 3200.
    const line = (code: string) => salesV!.lines.find((l) => l.ledger.code === code);
    assert.equal(line("SALES")?.credit, 320000, "sales is the taxable value");
    assert.equal(line("GST_OUTPUT_CGST")?.credit, 28800);
    assert.equal(line("GST_OUTPUT_SGST")?.credit, 28800);
    assert.equal(line("GST_OUTPUT_IGST"), undefined, "a local sale posts no IGST");
    assert.equal(line("AR")?.debit, 377600, "AR is the full payable, tax included");
    const outstanding = await books.outstanding(factory.id);
    assert.equal(outstanding.youllGet, 2776);
  });

  it("imports the khata customer list at 46 parties and the 12 Sep 2026 totals", async () => {
    const { factory, asOwner } = await staffFactory("khata");
    const body = readFileSync(path.join(root, "fixtures/khata/customer-list.json"), "utf8");
    const first = await khata.importList(asOwner, { fileName: "customer-list.json", body });
    const again = await khata.importList(asOwner, { fileName: "customer-list.json", body });
    assert.equal(first.id, again.id);
    const parties = await books.parties(factory.id);
    assert.equal(parties.length, 46);
    const mh = parties.find((p) => p.name === "Rajasthan Tiles Mh");
    assert.equal(mh?.youllGet, 29616);
    const shakti = parties.find((p) => /shakti/i.test(p.name));
    assert.equal(shakti?.youllGet, 577166);
    const nr = parties.find((p) => p.name === "NR JOB");
    assert.equal(nr?.kind, "job");
    assert.equal(nr?.youllGive, 22351);
    const out = await books.outstanding(factory.id);
    assert.equal(out.youllGet, 12_561_248);
    assert.equal(out.youllGive, 163_671);
    const receipts = await prisma.voucher.count({ where: { factoryId: factory.id, type: "receipt" } });
    assert.equal(receipts, 0);
  });

  it("refuses to let an operator settle invoices or book spend by confirming a rokad", async () => {
    const { factory, asOwner } = await staffFactory("intake-escalation");
    const opRow = await users.provision(asOwner, { username: "esc-operator", role: "operator" });
    const asOperator: AuthenticatedUser = {
      ...asOwner,
      id: opRow.user.id,
      username: "esc-operator",
      role: "operator",
    };

    // An operator may legitimately propose the day's rokad — that posts nothing.
    const outOnly = Buffer.from(
      "date,particulars,in,out,mode,partyName\n2026-09-12,Diesel,0,500,cash,\n",
    ).toString("base64");
    const draft = await intake.propose(asOwner, {
      kind: "rokad",
      date: "2026-09-12",
      fileName: "rokad.csv",
      contentType: "text/csv",
      base64: outOnly,
    });

    // Confirming it books an expense, which an operator cannot do directly. Being
    // allowed to handle the draft never granted that.
    await assert.rejects(
      () => intake.confirm(asOperator, draft.id),
      /a operator cannot do/i,
    );
    assert.equal(
      await prisma.expense.count({ where: { factoryId: factory.id } }),
      0,
      "a refused confirm must not have posted anything",
    );
    assert.equal(
      (await prisma.intakeDraft.findUniqueOrThrow({ where: { id: draft.id } })).status,
      "proposed",
      "and must leave the draft confirmable by someone who may",
    );

    // Same for the cash-in side, which settles a customer invoice.
    const inRow = Buffer.from(
      "date,particulars,in,out,mode,partyName\n2026-09-12,On account,900,0,cash,Acme\n",
    ).toString("base64");
    const payDraft = await intake.propose(asOwner, {
      kind: "rokad",
      date: "2026-09-12",
      fileName: "rokad2.csv",
      contentType: "text/csv",
      base64: inRow,
    });
    await assert.rejects(
      () => intake.confirm(asOperator, payDraft.id),
      /a operator cannot do/i,
    );

    // Someone who may post it still can — a different person, per the four-eyes rule.
    const acctRow = await legacyAccount(asOwner, { username: "esc-accounts", role: "accountant" });
    const asAccountant: AuthenticatedUser = {
      ...asOwner,
      id: acctRow.user.id,
      username: "esc-accounts",
      role: "accountant",
    };
    const ok = await intake.confirm(asAccountant, draft.id);
    assert.equal(ok.status, "confirmed");
    assert.equal(await prisma.expense.count({ where: { factoryId: factory.id } }), 1);
  });

  it("books a real supplier bill whose GST does not divide evenly", async () => {
    // A dry run at factory volume rejected all 104 expenses with "Voucher is not
    // balanced". Cause: the expense ledger was debited the taxable value the
    // accountant typed, the GST heads were computed from the rate, and the credit was
    // the bill total — three figures that only agree when the arithmetic happens to be
    // exact. A Rs 18,000 diesel bill at 18% has a taxable value of Rs 15,254.237...,
    // so it never is.
    const { factory, asOwner } = await staffFactory("rounding");
    // Without a GST profile no tax is computed at all and these would post trivially,
    // proving nothing. The input credit is the whole point.
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });

    const bills: Array<[string, number, number, number]> = [
      // label, amount, taxableAmount, ratePct
      ["diesel 18000 @18%", 18000, 15254, 18],
      ["diesel 18000 @18% (rounded up)", 18000, 15255, 18],
      ["freight 9000 @5%", 9000, 8571, 5],
      ["exact 11800 @18%", 11800, 10000, 18],
    ];
    let i = 0;
    for (const [label, amount, taxableAmount, gstRatePct] of bills) {
      await expenses.create(asOwner, {
        category: "diesel",
        amount,
        taxableAmount,
        gstRatePct,
        expenseDate: currentFactoryDate(),
        clientOpId: `round-${i++}`,
      });
    }
    assert.equal(
      await prisma.expense.count({ where: { factoryId: factory.id } }),
      bills.length,
      "every one of these is an ordinary bill and must post",
    );

    // Balance is the point: the credit is the bill, the tax heads follow the rate, and
    // the expense ledger takes the remainder.
    const vouchers = await prisma.voucher.findMany({
      where: { factoryId: factory.id, source: "expense_create" },
      include: { lines: true },
    });
    assert.equal(vouchers.length, bills.length);
    for (const voucher of vouchers) {
      const debit = voucher.lines.reduce((sum, l) => sum + l.debit, 0);
      const credit = voucher.lines.reduce((sum, l) => sum + l.credit, 0);
      assert.equal(debit, credit, `voucher ${voucher.id} must balance to the paise`);
    }

    // A figure that is wrong rather than rounded is still refused, and now says why.
    await assert.rejects(
      () =>
        expenses.create(asOwner, {
          category: "diesel",
          amount: 18000,
          taxableAmount: 1000,
          gstRatePct: 18,
          expenseDate: currentFactoryDate(),
          clientOpId: "round-wrong",
        }),
      /does not come to the bill total/i,
      "a taxable value nowhere near the bill is a typo, not rounding",
    );
  });

  it("keeps a last-day-of-month invoice inside that month's GST position", async () => {
    // voucher.operationalDate is a DATE column. The month window used to be built from
    // instants (00:00 IST = 18:30 UTC the previous day), which Postgres truncated to a
    // date — so the exclusive end landed ON the last day and excluded it. Every invoice
    // raised on the 30th or 31st dropped out of that month's output tax, silently.
    const { factory, asOwner } = await staffFactory("month-edge");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    await expenses.create(asOwner, {
      category: "consumables",
      amount: 11800,
      taxableAmount: 10000,
      gstRatePct: 18,
      expenseDate: "2026-08-31",
      clientOpId: "edge-last-day",
    });
    const august = await gst.position(factory.id, "2026-08");
    assert.equal(august.input.cgst, 900, "the 31st belongs to August");
    assert.equal(august.input.sgst, 900);

    const september = await gst.position(factory.id, "2026-09");
    assert.equal(september.input.cgst, 0, "and not to September");
  });

  it("backstops the money-moving services against any caller, not just the route", async () => {
    // The route guards were the only gate, which is how intake reached past them.
    // Asserting inside means a future caller cannot widen this by accident.
    const { asOwner } = await staffFactory("backstop");
    const opRow = await users.provision(asOwner, { username: "bs-operator", role: "operator" });
    const asOperator: AuthenticatedUser = {
      ...asOwner,
      id: opRow.user.id,
      username: "bs-operator",
      role: "operator",
    };
    await assert.rejects(
      () =>
        expenses.create(asOperator, {
          category: "diesel",
          amount: 100,
          expenseDate: "2026-09-12",
        }),
      /forbidden|not allowed|permission/i,
    );
  });

  it("rejects a supervisor confirming their own rokad draft and locks the cash drawer", async () => {
    const { factory, asOwner } = await staffFactory("intake");
    const supRow = await prisma.appUser.create({
      data: {
        factoryId: factory.id,
        username: `s-${factory.id.slice(0, 8)}`,
        name: "Sup",
        role: "supervisor",
        passwordHash: await hashPassword("ChangeMeNow!12"),
        mustChangePassword: false,
      },
    });
    const asSup: AuthenticatedUser = {
      ...owner,
      id: supRow.id,
      factoryId: factory.id,
      username: supRow.username,
      role: "supervisor",
    };
    const csv = Buffer.from("date,particulars,in,out,mode,partyName\n2026-09-12,Diesel,0,500,cash,\n").toString("base64");
    const draft = await intake.propose(asSup, {
      kind: "rokad",
      date: "2026-09-12",
      fileName: "rokad.csv",
      contentType: "text/csv",
      base64: csv,
    });
    assert.equal(draft.status, "proposed");
    await assert.rejects(() => intake.confirm(asSup, draft.id), /cannot confirm/i);
    const confirmed = await intake.confirm(asOwner, draft.id);
    assert.equal(confirmed.status, "confirmed");
    const exp = await prisma.expense.findMany({ where: { factoryId: factory.id } });
    assert.equal(exp.length, 1);
    assert.equal(Number(exp[0]?.amount), 500);

    const pdf = await intake.propose(asOwner, {
      kind: "dpr",
      date: "2026-09-12",
      fileName: "dpr.pdf",
      contentType: "application/pdf",
      base64: Buffer.from("%PDF-1.4 fake").toString("base64"),
    });
    assert.equal(pdf.status, "unreadable");

    await books.lockDrawer(asOwner, new Date("2026-09-12T01:30:00Z"), 0);
    await assert.rejects(
      () =>
        expenses.create(asOwner, {
          category: "diesel",
          amount: 100,
          expenseDate: "2026-09-12",
          clientOpId: "locked-exp",
        }),
      /locked/i,
    );
  });

  /**
   * Build an order over several slabs, packed and ready to ship.
   *
   * Shared by the partial-dispatch cases, which all need the same starting point:
   * one order whose slabs can leave the yard in more than one lorry.
   */
  async function orderReadyToShip(label: string, slabCount: number) {
    const { factory, asOwner } = await staffFactory(label);
    const finished = await prisma.inventoryLocation.findFirstOrThrow({
      where: { factoryId: factory.id, code: "FINISHED_STOCK" },
    });
    const slabs = [];
    for (let i = 0; i < slabCount; i += 1) {
      slabs.push(
        await prisma.slab.create({
          data: {
            factoryId: factory.id,
            slabSerial: `${label}-${i}`,
            varietyName: "Tan Brown",
            locationId: finished.id,
          },
        }),
      );
    }
    const customer = await sales.createCustomer(asOwner, `${label} Co`);
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-12",
      clientOpId: `${label}-order`,
      lines: slabs.map((slab) => ({ slabId: slab.id, quantitySqft: 10, rate: 100 })),
    })) as { id: string };
    await sales.pack(asOwner, order.id, slabs.map((s) => s.id));
    return { factory, asOwner, order, slabs };
  }

  const statusOf = async (orderId: string) =>
    (await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } })).status;

  it("ships the rest of the order on a second lorry", async () => {
    // The yard loads what fits, then sends the remainder later. Both batches must
    // actually move. The first default clientOpId was derived from the order alone,
    // so the second call matched the first one's stored response, answered 201 and
    // shipped nothing: half the order stayed in PACKING while the books showed it
    // gone.
    const { factory, asOwner, order, slabs } = await orderReadyToShip("twoloads", 4);
    const firstLoad = slabs.slice(0, 2).map((s) => s.id);
    const secondLoad = slabs.slice(2).map((s) => s.id);

    const first = await sales.dispatch(asOwner, order.id, firstLoad);
    const second = await sales.dispatch(asOwner, order.id, secondLoad);

    assert.notEqual(
      (first as { id: string }).id,
      (second as { id: string }).id,
      "a different load is a different delivery, not a replay",
    );
    assert.equal(await prisma.delivery.count({ where: { factoryId: factory.id } }), 2);
    const dispatched = await prisma.slab.count({
      where: { factoryId: factory.id, salesStatus: "dispatched" },
    });
    assert.equal(dispatched, 4, "every slab on the order left the yard");
    assert.equal(
      await prisma.inventoryMovement.count({
        where: { factoryId: factory.id, movementType: "DISPATCH" },
      }),
      4,
    );
  });

  it("still treats a resent identical load as one dispatch", async () => {
    // The other half of the contract: an offline device that resends the same
    // batch must not ship it twice.
    const { factory, asOwner, order, slabs } = await orderReadyToShip("resend", 2);
    const load = slabs.map((s) => s.id);
    const first = await sales.dispatch(asOwner, order.id, load);
    const replay = await sales.dispatch(asOwner, order.id, load);
    assert.equal((first as { id: string }).id, (replay as { id: string }).id);
    assert.equal(await prisma.delivery.count({ where: { factoryId: factory.id } }), 1);
    assert.equal(
      await prisma.inventoryMovement.count({
        where: { factoryId: factory.id, movementType: "DISPATCH" },
      }),
      2,
      "two slabs, one dispatch each",
    );
  });

  it("walks the order from CONFIRMED to PARTIALLY_DELIVERED to DELIVERED", async () => {
    // Nothing advanced the order's status, so an order that had entirely shipped
    // still read CONFIRMED. Every report that counts open orders was wrong.
    const { asOwner, order, slabs } = await orderReadyToShip("walk", 3);
    assert.equal(await statusOf(order.id), "CONFIRMED");

    await sales.dispatch(asOwner, order.id, [slabs[0]!.id]);
    assert.equal(await statusOf(order.id), "PARTIALLY_DELIVERED", "one of three has gone");

    await sales.dispatch(asOwner, order.id, [slabs[1]!.id]);
    assert.equal(await statusOf(order.id), "PARTIALLY_DELIVERED", "two of three");

    await sales.dispatch(asOwner, order.id, [slabs[2]!.id]);
    assert.equal(await statusOf(order.id), "DELIVERED", "the last slab closes the order");
  });

  it("marks an order delivered when its whole load goes at once", async () => {
    const { asOwner, order, slabs } = await orderReadyToShip("oneload", 3);
    await sales.dispatch(asOwner, order.id, slabs.map((s) => s.id));
    assert.equal(await statusOf(order.id), "DELIVERED");
  });

  it("refuses a clientOpId reused for a different load, at the service", async () => {
    // Reusing a key for different slabs is a client bug. Answering it with the
    // first load's response is how the original fault stayed invisible, so it is
    // refused rather than quietly mis-answered.
    //
    // Service level only, and deliberately so: over HTTP the global
    // IdempotencyInterceptor looks a key up on (factory, clientOpId) alone and
    // replays before this code runs, so a real client still receives the first
    // load's response. Verified by hand against a running server. Teaching that
    // interceptor to compare a request hash would change every write route in the
    // app, offline replay included, so it belongs in its own change. This keeps the
    // service correct on its own terms meanwhile.
    const { asOwner, order, slabs } = await orderReadyToShip("reuse", 2);
    await sales.dispatch(asOwner, order.id, [slabs[0]!.id], { clientOpId: "reuse-key-1" });
    await assert.rejects(
      () => sales.dispatch(asOwner, order.id, [slabs[1]!.id], { clientOpId: "reuse-key-1" }),
      /different request|CLIENT_OP_ID_REUSED/i,
    );
    // And the slab it refused to ship is still in the yard.
    const untouched = await prisma.slab.findUniqueOrThrow({ where: { id: slabs[1]!.id } });
    assert.notEqual(untouched.salesStatus, "dispatched");
  });

  it("dispatches packed slabs and retries the same clientOpId", async () => {
    const { factory, asOwner } = await staffFactory("disp");
    const finished = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "FINISHED_STOCK" },
    });
    const packing = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "PACKING" },
    });
    const delivered = await prisma.inventoryLocation.findFirst({
      where: { factoryId: factory.id, code: "DELIVERED" },
    });
    const slab = await prisma.slab.create({
      data: { factoryId: factory.id, slabSerial: "DISP-1", varietyName: "White", locationId: finished!.id },
    });
    const customer = await sales.createCustomer(asOwner, "Disp Co");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-12",
      clientOpId: "disp-order",
      lines: [{ slabId: slab.id, quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    await assert.rejects(() => sales.dispatch(asOwner, order.id, [slab.id], { clientOpId: "disp-1" }), /PACKING/i);
    await sales.pack(asOwner, order.id, [slab.id]);
    const packed = await prisma.slab.findUnique({ where: { id: slab.id } });
    assert.equal(packed?.locationId, packing!.id);
    assert.notEqual(packed?.salesStatus, "dispatched");
    const first = await sales.dispatch(asOwner, order.id, [slab.id], { clientOpId: "disp-1" });
    const retry = await sales.dispatch(asOwner, order.id, [slab.id], { clientOpId: "disp-1" });
    assert.equal((first as { id: string }).id, (retry as { id: string }).id);
    const after = await prisma.slab.findUnique({ where: { id: slab.id } });
    assert.equal(after?.salesStatus, "dispatched");
    assert.equal(after?.locationId, delivered!.id);
    const moves = await prisma.inventoryMovement.count({
      where: { factoryId: factory.id, movementType: "DISPATCH" },
    });
    assert.equal(moves, 1);
  });

  it("imports the live khata customer-list PDF to the locked totals", async () => {
    const { factory, asOwner } = await staffFactory("khatapdf");
    const bytes = readFileSync(path.join(root, "fixtures/khata/pdf/customer-list.pdf"));
    const preview = khata.preview({ fileName: "customer-list.pdf", base64: bytes.toString("base64") });
    assert.equal(preview.totalsOk, true);
    const batch = await khata.importList(asOwner, {
      fileName: "customer-list.pdf",
      base64: bytes.toString("base64"),
      contentType: "application/pdf",
      confirm: true,
    });
    assert.equal((batch as { partyCount: number }).partyCount, 46);
    const out = await books.outstanding(factory.id);
    assert.equal(out.youllGet, 12_561_248);
    assert.equal(out.youllGive, 163_671);
  });

  it("sells to another plant the same way as any customer", async () => {
    const { factory, asOwner } = await staffFactory("firm");
    const customer = await sales.createCustomer(asOwner, "South Yard");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-12",
      clientOpId: "firm-order-1",
      lines: [{ quantitySqft: 40, rate: 180 }],
    })) as { id: string };
    const inv = await sales.invoice(asOwner, order.id, "firm-inv-1");
    assert.equal(Number(inv.amount), 7200);
    const first = await sales.pay(asOwner, inv.id, {
      amount: 7200,
      method: "neft",
      paidAt: "2026-09-12",
      clientOpId: "firm-pay-1",
    });
    const retry = await sales.pay(asOwner, inv.id, {
      amount: 7200,
      method: "neft",
      paidAt: "2026-09-12",
      clientOpId: "firm-pay-1",
    });
    assert.equal(first.id, retry.id);
    assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id } }), 1);
    const outstanding = await books.outstanding(factory.id);
    assert.equal(outstanding.youllGet, 0);
    const party = (await books.parties(factory.id)).find((p) => p.name === "South Yard");
    assert.ok(party);
    assert.equal(party.kind, "customer");
  });

  it("builds a wage sheet from six present days and posts one labour voucher", async () => {
    const { factory, asOwner, asManager } = await staffFactory("muster");
    const worker = await muster.createWorker(asOwner, { name: "Cutter Ram", kind: "cutter", dailyWage: 800 });
    for (let d = 1; d <= 6; d++) {
      await muster.mark(asOwner, {
        workerId: worker.id,
        date: `2026-09-0${d}`,
        status: "present",
      });
    }
    const sheet = await muster.draftSheet(asOwner, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-06",
      clientOpId: "wage-1",
    });
    const line = sheet!.lines[0]!;
    assert.equal(Number(line.days), 6);
    assert.equal(line.amountMinor, 6 * 80000);
    await assert.rejects(() => muster.confirm(asOwner, sheet!.id), /cannot confirm/i);
    await muster.confirm(asManager, sheet!.id);
    const asSup: AuthenticatedUser = { ...asOwner, role: "supervisor" };
    await assert.rejects(() => muster.pay(asSup, sheet!.id, "cash"), /Insufficient role/i);
    await muster.pay(asOwner, sheet!.id, "cash");
    const vouchers = await prisma.voucher.findMany({ where: { factoryId: factory.id, source: "muster_pay" } });
    assert.equal(vouchers.length, 1);
    await muster.pay(asOwner, sheet!.id, "cash");
    assert.equal(await prisma.voucher.count({ where: { factoryId: factory.id, source: "muster_pay" } }), 1);
  });

  it("issues a mock IRN and includes INV in GSTR-1 after GSTIN is set", async () => {
    const { factory, asOwner } = await staffFactory("gst");
    await assert.rejects(() => gst.einvoice(asOwner, "missing"), /GSTIN missing/i);
    await gst.upsertProfile(asOwner, { gstin: "08AAAAA0000A1Z5", legalName: "Vedam", stateCode: "08" });
    const customer = await sales.createCustomer(asOwner, "Gst Co", undefined, {
      gstin: "08AABCG1234H1Z1",
    });
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-12",
      clientOpId: "gst-order",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "gst-inv");
    const irn = await gst.einvoice(asOwner, invoice.id);
    const again = await gst.einvoice(asOwner, invoice.id);
    assert.equal(irn.id, again.id);
    assert.match(irn.irn, /^MOCK-IRN-/);
    assert.equal(irn.source, "mock");
    const gstr = await gst.gstr1(factory.id, currentFactoryMonth());
    assert.ok(gstr.b2b.some((r) => r.doc.startsWith("INV-")));
    assert.match(gstr.csv, /INV-/);
  });

  it("charges GST on top of the quoted rate and splits it by place of supply", async () => {
    const { factory, asOwner } = await staffFactory("pos");
    // Vedam Granites is Rajasthan: the GSTIN's first two characters are the state.
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });

    const bill = async (name: string, stateCode: string | undefined, tag: string) => {
      // Registered dealers, so these belong in B2B; the retail path is covered separately.
      const customer = await sales.createCustomer(asOwner, name, undefined, {
        gstin: `${stateCode}AABCP0000P1Z9`,
      });
      const order = (await sales.createOrder(asOwner, {
        customerId: customer.id,
        orderDate: "2026-09-12",
        clientOpId: `${tag}-order`,
        lines: [{ quantitySqft: 10, rate: 100 }],
      })) as { id: string };
      return sales.invoice(asOwner, order.id, `${tag}-inv`);
    };

    // Rajasthan buyer: one state, so the 18% splits into 9% CGST + 9% SGST.
    const local = await bill("Jaipur Marbles", "08", "local");
    assert.equal(Number(local.taxableAmount), 1000, "the quoted rate is the taxable value");
    assert.equal(Number(local.cgstAmount), 90);
    assert.equal(Number(local.sgstAmount), 90);
    assert.equal(Number(local.igstAmount), 0);
    assert.equal(Number(local.amount), 1180, "the customer owes rate plus tax, not rate");
    assert.equal(local.placeOfSupply, "08");
    assert.equal(Number(local.gstRatePct), 18);

    // Andhra Pradesh buyer: different state, so the whole 18% is IGST.
    const outside = await bill("Ongole Stone Works", "37", "outside");
    assert.equal(Number(outside.igstAmount), 180);
    assert.equal(Number(outside.cgstAmount), 0);
    assert.equal(Number(outside.sgstAmount), 0);
    assert.equal(Number(outside.amount), 1180, "the buyer pays the same either way");
    assert.equal(outside.placeOfSupply, "37");

    // The books must carry the heads apart, never merged.
    const ledgerTotal = async (code: string) => {
      const ledger = await prisma.ledger.findFirst({ where: { factoryId: factory.id, code } });
      if (!ledger) return 0;
      const agg = await prisma.voucherLine.aggregate({
        where: { ledgerId: ledger.id },
        _sum: { credit: true, debit: true },
      });
      return (agg._sum.credit ?? 0) - (agg._sum.debit ?? 0);
    };
    assert.equal(await ledgerTotal("GST_OUTPUT_CGST"), 9_000, "CGST in paise");
    assert.equal(await ledgerTotal("GST_OUTPUT_SGST"), 9_000);
    assert.equal(await ledgerTotal("GST_OUTPUT_IGST"), 18_000);
    assert.equal(await ledgerTotal("SALES"), 200_000, "sales is taxable value only");
    assert.equal(await ledgerTotal("AR"), -236_000, "AR is debited with the full payable");

    // AR must follow the payable, so a payment of the pre-tax figure cannot settle it.
    await assert.rejects(
      () =>
        sales.pay(asOwner, local.id, {
          amount: 1181,
          method: "cash",
          paidAt: "2026-09-12",
          clientOpId: "pos-overpay",
        }),
      /exceeds invoice amount/i,
    );
    await sales.pay(asOwner, local.id, {
      amount: 1180,
      method: "cash",
      paidAt: "2026-09-12",
      clientOpId: "pos-pay",
    });

    // GSTR-1 reports the heads separately, read off the documents as issued.
    const gstr = await gst.gstr1(factory.id, currentFactoryMonth());
    const localRow = gstr.b2b.find((r) => r.doc === local.invoiceNumber);
    const outsideRow = gstr.b2b.find((r) => r.doc === outside.invoiceNumber);
    assert.deepEqual(
      { taxable: localRow?.taxable, cgst: localRow?.cgst, sgst: localRow?.sgst, igst: localRow?.igst },
      { taxable: 1000, cgst: 90, sgst: 90, igst: 0 },
    );
    assert.deepEqual(
      { taxable: outsideRow?.taxable, cgst: outsideRow?.cgst, sgst: outsideRow?.sgst, igst: outsideRow?.igst },
      { taxable: 2000 - 1000, cgst: 0, sgst: 0, igst: 180 },
    );
    assert.equal(gstr.totals.cgst, 90);
    assert.equal(gstr.totals.sgst, 90);
    assert.equal(gstr.totals.igst, 180);
    assert.match(gstr.csv, /type,number,gstin,place_of_supply,rate_pct,taxable,cgst,sgst,igst,total,irn/);

    // A tax figure must never move because a profile row was edited afterwards.
    await gst.upsertProfile(asOwner, {
      gstin: "37AAUFV3603N1ZH",
      legalName: "Vedam Granites AP",
      stateCode: "37",
    });
    const reread = await prisma.invoice.findUniqueOrThrow({ where: { id: local.id } });
    assert.equal(Number(reread.cgstAmount), 90, "an issued invoice is frozen");
    assert.equal(reread.supplierState, "08");
  });

  it("taxes a retail buyer with no GSTIN and files them under B2C, not B2B", async () => {
    const { factory, asOwner } = await staffFactory("b2c");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    // A walk-in with no GSTIN, in Rajasthan: still 9 + 9.
    const local = await sales.createCustomer(asOwner, "Walk-in Ramesh", undefined, { stateCode: "08" });
    // A retail buyer in Andhra Pradesh with no GSTIN: still 18 IGST.
    const outside = await sales.createCustomer(asOwner, "Retail AP", undefined, { stateCode: "37" });

    const billTo = async (customerId: string, tag: string, rate: number) => {
      const order = (await sales.createOrder(asOwner, {
        customerId,
        orderDate: "2026-09-12",
        clientOpId: `${tag}-order`,
        lines: [{ quantitySqft: 10, rate }],
      })) as { id: string };
      return sales.invoice(asOwner, order.id, `${tag}-inv`);
    };
    const localInv = await billTo(local.id, "b2clocal", 100);
    const outsideInv = await billTo(outside.id, "b2cout", 100);

    assert.equal(Number(localInv.cgstAmount), 90, "no GSTIN does not mean no tax");
    assert.equal(Number(localInv.sgstAmount), 90);
    assert.equal(Number(outsideInv.igstAmount), 180, "out of state is IGST even for retail");

    const gstr = await gst.gstr1(factory.id, currentFactoryMonth());
    assert.equal(gstr.b2b.length, 0, "a buyer with no GSTIN is never B2B");
    const b2cDocs = [...gstr.b2cSmall, ...gstr.b2cLarge].map((r) => r.doc);
    assert.ok(b2cDocs.includes(localInv.invoiceNumber));
    assert.ok(b2cDocs.includes(outsideInv.invoiceNumber));
    assert.equal(gstr.totals.cgst + gstr.totals.sgst + gstr.totals.igst, 360, "all of it is still filed");
    assert.match(gstr.csv, /^B2CS,/m);

    // A large inter-state retail sale is reported invoice-wise, not consolidated.
    const bigInv = await billTo(outside.id, "b2cbig", 40_000);
    const after = await gst.gstr1(factory.id, currentFactoryMonth());
    assert.ok(
      after.b2cLarge.some((r) => r.doc === bigInv.invoiceNumber),
      "an inter-state retail invoice over the threshold belongs in B2CL",
    );
    assert.ok(!after.b2cSmall.some((r) => r.doc === bigInv.invoiceNumber));
  });

  it("bills packaging and labour charges as part of the taxable value", async () => {
    const { factory, asOwner } = await staffFactory("charges");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    const customer = await sales.createCustomer(asOwner, "Charges Co", undefined, { stateCode: "08" });
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-12",
      clientOpId: "charges-order",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "charges-inv", [
      { label: "Customised packaging", amount: 500 },
      { label: "Loading labour", amount: 300 },
      { label: "Demurrage", amount: 200 },
      // A pure reimbursement billed at cost: owed, but not part of the taxable value.
      { label: "Octroi paid on behalf", amount: 100, taxable: false },
    ]);

    // 1000 slabs + 1000 taxable charges = 2000 taxable, tax 360, plus 100 untaxed.
    assert.equal(Number(invoice.taxableAmount), 2000, "charges join the taxable value");
    assert.equal(Number(invoice.cgstAmount), 180);
    assert.equal(Number(invoice.sgstAmount), 180);
    assert.equal(Number(invoice.exemptAmount), 100);
    assert.equal(Number(invoice.amount), 2460, "2000 + 360 tax + 100 untaxed");

    const stored = await prisma.invoiceCharge.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { label: "asc" },
    });
    assert.equal(stored.length, 4);
    assert.equal(stored.filter((c) => !c.taxable).length, 1);

    const voucher = await prisma.voucher.findFirst({
      where: { factoryId: factory.id, source: "sales_invoice" },
      include: { lines: { include: { ledger: true } } },
    });
    const line = (code: string) => voucher!.lines.find((l) => l.ledger.code === code);
    assert.equal(line("AR")?.debit, 246_000, "AR carries the untaxed charge too");
    assert.equal(line("SALES")?.credit, 210_000, "sales is taxable value plus the reimbursement");
    assert.equal(line("GST_OUTPUT_CGST")?.credit, 18_000);

    await assert.rejects(
      () => sales.invoice(asOwner, order.id, "charges-bad", [{ label: "  ", amount: 50 }]),
      /needs a label/i,
    );
    await assert.rejects(
      () => sales.invoice(asOwner, order.id, "charges-bad2", [{ label: "Freight", amount: -5 }]),
      /positive amount/i,
    );
  });

  it("records a cash sale with no invoice and keeps it out of GSTR-1", async () => {
    const { factory, asOwner } = await staffFactory("cash");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    const customer = await sales.createCustomer(asOwner, "Local Counter", undefined, { stateCode: "08" });
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: currentFactoryDate(),
      clientOpId: "cash-order",
      billingMode: "cash_unbilled",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };

    // A cash-sale order cannot be turned into a tax invoice by accident.
    await assert.rejects(() => sales.invoice(asOwner, order.id, "cash-inv"), /cannot be invoiced/i);

    const sale = await sales.recordCashSale(asOwner, order.id, {
      amount: 1000,
      saleDate: currentFactoryDate(),
      clientOpId: "cash-1",
      buyerName: "Ramesh",
    });
    const retry = await sales.recordCashSale(asOwner, order.id, {
      amount: 1000,
      saleDate: currentFactoryDate(),
      clientOpId: "cash-1",
      buyerName: "Ramesh",
    });
    assert.equal(retry.id, sale.id, "a replayed clientOpId must not double-count cash");

    // The cash and the revenue are booked; the revenue is quarantined on its own ledger.
    const voucher = await prisma.voucher.findFirst({
      where: { factoryId: factory.id, source: "cash_sale" },
      include: { lines: { include: { ledger: true } } },
    });
    assert.ok(voucher, "a cash sale still posts a balanced voucher");
    assert.equal(voucher!.lines.find((l) => l.ledger.code === "CASH")?.debit, 100_000);
    assert.equal(voucher!.lines.find((l) => l.ledger.code === "SALES_UNBILLED")?.credit, 100_000);
    assert.equal(
      voucher!.lines.find((l) => l.ledger.code === "SALES"),
      undefined,
      "unbilled revenue must never touch the invoiced sales ledger",
    );
    assert.equal(await prisma.invoice.count({ where: { salesOrderId: order.id } }), 0);

    // Nothing reaches the return, but the return says how much was left out.
    const gstr = await gst.gstr1(factory.id, currentFactoryMonth());
    assert.equal(gstr.b2b.length + gstr.b2cSmall.length + gstr.b2cLarge.length, 0);
    assert.equal(gstr.totals.cgst + gstr.totals.sgst + gstr.totals.igst, 0);
    assert.equal(gstr.excludedCashSales.count, 1);
    assert.equal(gstr.excludedCashSales.amount, 1000);

    // And the owner is told, rather than having to go looking.
    const brief = await reports.ceoBrief(factory.id);
    assert.equal(brief.unbilledCashMtd, 1000);
    assert.ok(
      brief.exceptions.some((e) => e.code === "UNBILLED_CASH_SALES"),
      "unbilled turnover must surface on the CEO brief",
    );

    // An audit trail exists even though no GST document does.
    const audit = await prisma.auditEvent.findFirst({
      where: { factoryId: factory.id, action: "sales.cash_sale" },
    });
    assert.ok(audit, "a cash sale is still audited");
  });

  it("claims input credit on a block purchase at 5% and nets it against 18% output", async () => {
    const { factory, asOwner } = await staffFactory("itc");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    const supplier = await inventory.createSupplier(asOwner, "Kishangarh Quarry", undefined, {
      gstin: "08AABCQ1111K1Z0",
    });

    // A rough block is HSN 2516 at 5%, not the 18% a finished slab carries.
    const received = (await inventory.receiveBlock(asOwner, {
      serialNumber: "ITC-1",
      varietyName: "Kashmir White",
      supplierId: supplier.id,
      clientOpId: "itc-recv",
      weightTons: 20,
      purchaseTaxable: 100000,
    })) as { block: { id: string } };
    const block = await prisma.rawBlock.findUniqueOrThrow({ where: { id: received.block.id } });
    assert.equal(Number(block.purchaseGstRatePct), 5, "rough blocks default to the 5% slab");
    assert.equal(Number(block.purchaseCgst), 2500);
    assert.equal(Number(block.purchaseSgst), 2500);
    assert.equal(Number(block.purchaseIgst), 0);
    assert.equal(Number(block.purchaseTaxable), 100000, "cost basis excludes recoverable tax");
    assert.equal(Number(block.invoicedAmount), 105000, "the vendor is owed the whole bill");

    const ledgerTotal = async (code: string, credit = false) => {
      const ledger = await prisma.ledger.findFirst({ where: { factoryId: factory.id, code } });
      if (!ledger) return 0;
      const agg = await prisma.voucherLine.aggregate({
        where: { ledgerId: ledger.id },
        _sum: { credit: true, debit: true },
      });
      const d = agg._sum.debit ?? 0;
      const c = agg._sum.credit ?? 0;
      return credit ? c - d : d - c;
    };
    assert.equal(await ledgerTotal("STOCK"), 10_000_000, "stock carries the pre-tax value");
    assert.equal(await ledgerTotal("GST_INPUT_CGST"), 250_000);
    assert.equal(await ledgerTotal("GST_INPUT_SGST"), 250_000);
    assert.equal(await ledgerTotal("AP", true), 10_500_000, "the supplier is owed taxable + tax");

    // A consumable on a different slab: the rate is per spend, not global.
    await expenses.create(asOwner, {
      category: "consumables",
      amount: 11200,
      taxableAmount: 10000,
      gstRatePct: 12,
      expenseDate: currentFactoryDate(),
      clientOpId: "itc-exp",
    });
    const spend = await prisma.expense.findFirstOrThrow({
      where: { factoryId: factory.id, idempotencyKey: "itc-exp" },
    });
    assert.equal(Number(spend.gstRatePct), 12, "consumables carry their own slab");
    assert.equal(Number(spend.cgstAmount) + Number(spend.sgstAmount), 1200);
    assert.equal(Number(spend.taxableAmount), 10000);
    assert.equal(
      await ledgerTotal("EXP_MISC"),
      1_000_000,
      "the expense ledger carries the pre-tax value, not the whole bill",
    );

    // Sell finished slabs at 18% and the position nets output against input.
    const customer = await sales.createCustomer(asOwner, "Slab Buyer", undefined, {
      gstin: "08AABCS2222L1Z0",
    });
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: currentFactoryDate(),
      clientOpId: "itc-order",
      lines: [{ quantitySqft: 100, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "itc-inv");
    assert.equal(Number(invoice.gstRatePct), 18, "finished slabs stay on 18");

    const position = await gst.position(factory.id, currentFactoryMonth());
    // Output 18% of 10,000 = 1,800 split 900/900. Input 2,500+2,500 on the block plus
    // 600+600 on the consumable = 3,100 per head.
    assert.equal(position.output.cgst, 900);
    assert.equal(position.input.cgst, 3100);
    assert.equal(position.net.cgst, -2200, "more credit than liability this month");
    assert.equal(position.netPayable, 0, "nothing to pay while credit exceeds output");
    assert.equal(position.creditCarried, 4400, "the unused credit carries forward");
  });

  it("offers the statutory slabs and refuses anything else", async () => {
    const { asOwner } = await staffFactory("slabs");
    await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam Granites",
      stateCode: "08",
    });
    assert.deepEqual(gst.rates().slabs, [0, 0.25, 3, 5, 12, 18, 28]);
    assert.equal(gst.rates().defaults.rawBlock, 5);
    assert.equal(gst.rates().defaults.finishedSlab, 18);

    const supplier = await inventory.createSupplier(asOwner, "Bad Rate Quarry", undefined, {
      gstin: "08AABCQ3333M1Z0",
    });
    await assert.rejects(
      () =>
        inventory.receiveBlock(asOwner, {
          serialNumber: "SLAB-BAD",
          varietyName: "White",
          weightTons: 18,
          supplierId: supplier.id,
          clientOpId: "slab-bad",
          purchaseTaxable: 1000,
          gstRatePct: 15,
        }),
      /not a statutory slab/i,
    );
  });

  it("refuses a state code that contradicts the GSTIN", async () => {
    const { asOwner } = await staffFactory("gstin");
    await assert.rejects(
      () =>
        gst.upsertProfile(asOwner, {
          gstin: "08AAUFV3603N1ZH",
          legalName: "Vedam",
          stateCode: "37",
        }),
      /contradicts GSTIN/i,
    );
    await assert.rejects(
      () => gst.upsertProfile(asOwner, { gstin: "NOPE", legalName: "Vedam", stateCode: "08" }),
      /15 characters/i,
    );
    // The GSTIN is authoritative, so a blank state code is resolved from it.
    const saved = await gst.upsertProfile(asOwner, {
      gstin: "08AAUFV3603N1ZH",
      legalName: "Vedam",
      stateCode: "",
    });
    assert.equal(saved.stateCode, "08");
  });

  it("files GSTR-1 by IST calendar month, not the 07:00 operational-day cutover", async () => {
    const { factory, asOwner } = await staffFactory("gstmonth");
    await gst.upsertProfile(asOwner, { gstin: "08AAAAA0000A1Z6", legalName: "Vedam", stateCode: "08" });
    const customer = await sales.createCustomer(asOwner, "Boundary Co", undefined, {
      gstin: "08AABCB5678J1Z2",
    });
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-10-01",
      clientOpId: "gstmonth-order",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "gstmonth-inv");
    // 2026-10-01T01:00:00Z is 06:30 IST: before the 07:00 operational-day start,
    // but after 00:00 IST on 1 Oct, so it belongs in October's GSTR-1.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { createdAt: new Date("2026-10-01T01:00:00Z") },
    });
    const october = await gst.gstr1(factory.id, "2026-10");
    assert.ok(october.b2b.some((r) => r.doc === invoice.invoiceNumber));
    const september = await gst.gstr1(factory.id, "2026-09");
    assert.ok(!september.b2b.some((r) => r.doc === invoice.invoiceNumber));
  });

  it("copilot proposes a journal draft that only the other user can confirm", async () => {
    const { factory, asOwner, asManager } = await staffFactory("copilot");
    const draft = await copilot.propose(asOwner, { text: "CASH Dr 100\nSALES Cr 100", date: "2026-09-12" });
    assert.equal(draft.status, "proposed");
    assert.equal(draft.kind, "journal");
    await assert.rejects(() => intake.confirm(asOwner, draft.id), /cannot confirm/i);
    await intake.confirm(asManager, draft.id);
    const v = await prisma.voucher.findFirst({ where: { factoryId: factory.id, source: "copilot_journal" } });
    assert.ok(v);
  });

  it("answers a replayed clientOpId with the first result and refuses it from anyone else", async () => {
    const { asOwner, asManager } = await staffFactory("idem");
    const store = new IdempotencyService(prisma as never);
    const path = "/api/v1/cutting-sessions/abc/complete";
    assert.equal(await store.lookup(asOwner, "idem-op-0001", "POST", path), null);
    await store.remember(asOwner, "idem-op-0001", "POST", path, 201, { session: { id: "s1" }, slabs: [{ id: "x" }] });
    // A second remember (e.g. a service that stored its own row first) is not an error.
    await store.remember(asOwner, "idem-op-0001", "POST", path, 201, { other: true });
    const replay = await store.lookup(asOwner, "idem-op-0001", "POST", `${path}?x=1`);
    assert.deepEqual(replay?.response, { session: { id: "s1" }, slabs: [{ id: "x" }] });
    await assert.rejects(() => store.lookup(asManager, "idem-op-0001", "POST", path), /different request/);
    await assert.rejects(() => store.lookup(asOwner, "idem-op-0001", "POST", "/api/v1/expenses"), /different request/);
  });

  it("recognises a key the sales service stored itself", async () => {
    const { factory, asOwner } = await staffFactory("idemsvc");
    const finished = await prisma.inventoryLocation.findFirst({ where: { factoryId: factory.id, code: "FINISHED_STOCK" } });
    const slab = await prisma.slab.create({
      data: { factoryId: factory.id, slabSerial: "IDS-1", varietyName: "White", locationId: finished!.id },
    });
    const customer = await sales.createCustomer(asOwner, "Idem Co");
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-20",
      clientOpId: "idem-order-001",
      lines: [{ slabId: slab.id, quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    const store = new IdempotencyService(prisma as never);
    const replay = await store.lookup(asOwner, "idem-order-001", "POST", "/api/v1/sales-orders");
    assert.equal((replay?.response as { id: string }).id, order.id);
  });

  it("keeps an offline order for the slabs still free and lists the ones sold first", async () => {
    const { factory, asOwner, asManager } = await staffFactory("partial");
    const finished = await prisma.inventoryLocation.findFirst({ where: { factoryId: factory.id, code: "FINISHED_STOCK" } });
    const [a, b] = await Promise.all(
      ["PART-A", "PART-B"].map((slabSerial) =>
        prisma.slab.create({ data: { factoryId: factory.id, slabSerial, varietyName: "Black", locationId: finished!.id } }),
      ),
    );
    const customer = await sales.createCustomer(asOwner, "Online Buyer");
    // The online salesman takes slab A first.
    await sales.createOrder(asManager, {
      customerId: customer.id,
      orderDate: "2026-09-20",
      clientOpId: "partial-online",
      lines: [{ slabId: a.id, quantitySqft: 40, rate: 100 }],
    });
    // Without partial, the offline order is refused whole, as before.
    await assert.rejects(
      () =>
        sales.createOrder(asOwner, {
          customerId: customer.id,
          orderDate: "2026-09-20",
          clientOpId: "partial-strict",
          lines: [{ slabId: a.id, quantitySqft: 40, rate: 100 }, { slabId: b.id, quantitySqft: 40, rate: 100 }],
        }),
      /not available/,
    );
    const offline = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: "2026-09-20",
      clientOpId: "partial-offline",
      partial: true,
      lines: [{ slabId: a.id, quantitySqft: 40, rate: 100 }, { slabId: b.id, quantitySqft: 40, rate: 100 }],
    })) as { id: string; lines: Array<{ slabId: string }>; droppedSlabs: Array<{ slabId: string; slabSerial: string }> };
    assert.deepEqual(offline.lines.map((l) => l.slabId), [b.id]);
    assert.deepEqual(offline.droppedSlabs.map((d) => d.slabSerial), ["PART-A"]);

    // Packing and dispatch replayed for both slabs ship only the one the order kept.
    const packed = (await sales.pack(asOwner, offline.id, [a.id, b.id], true)) as { lines: unknown[]; skippedSlabs: string[] };
    assert.equal(packed.lines.length, 1);
    assert.deepEqual(packed.skippedSlabs, [a.id]);
    const shipped = (await sales.dispatch(asOwner, offline.id, [a.id, b.id], {
      clientOpId: "partial-dispatch",
      partial: true,
    })) as { lines: unknown[]; skippedSlabs: string[] };
    assert.equal(shipped.lines.length, 1);
    assert.deepEqual(shipped.skippedSlabs, [a.id]);
    const slabA = await prisma.slab.findUnique({ where: { id: a.id } });
    assert.equal(slabA?.salesStatus, "reserved", "the online buyer's slab is untouched");

    // An offline order whose every slab is gone is a conflict, not an empty order.
    await assert.rejects(
      () =>
        sales.createOrder(asOwner, {
          customerId: customer.id,
          orderDate: "2026-09-20",
          clientOpId: "partial-empty",
          partial: true,
          lines: [{ slabId: a.id, quantitySqft: 40, rate: 100 }],
        }),
      (error: { response?: { code?: string } }) => error.response?.code === "SLABS_UNAVAILABLE",
    );
    assert.equal(await prisma.salesOrder.count({ where: { factoryId: factory.id } }), 2);
  });

  it("books late-synced shop-floor work on the day it happened", async () => {
    const { factory, asOwner } = await staffFactory("late");
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000);
    const received = (await inventory.receiveBlock(asOwner, {
      serialNumber: "LATE-1",
      varietyName: "Tan Brown",
      clientOpId: "late-block",
      weightTons: 2,
      occurredAt: yesterday.toISOString(),
    })) as { block: { id: string; purchaseDate: string } };
    const machine = await prisma.machine.findFirst({ where: { factoryId: factory.id, name: "B-21" } });
    const session = await production.startCutting(asOwner, {
      rawBlockId: received.block.id,
      machineId: machine!.id,
      occurredAt: yesterday.toISOString(),
    });
    assert.equal(session.startedAt.toISOString(), yesterday.toISOString());
    const done = await production.completeCutting(asOwner, session.id, {
      totalSlabsCut: 3,
      finalGoodSlabCount: 3,
      occurredAt: yesterday.toISOString(),
    });
    assert.equal(done.slabs[0]!.createdAt.toISOString(), yesterday.toISOString());
    const today = await production.derivedDpr(factory.id, new Date(), new Date());
    assert.equal(today.slabsCut, 0, "late sync must not inflate today's DPR");
    const thatDay = await production.derivedDpr(factory.id, yesterday, yesterday);
    assert.equal(thatDay.slabsCut, 3);

    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    await assert.rejects(
      () => production.startCutting(asOwner, { rawBlockId: received.block.id, machineId: machine!.id, occurredAt: future }),
      /future/,
    );
    const stale = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    await assert.rejects(
      () => production.logCuttingDay(asOwner, session.id, { runtimeHours: 4, occurredAt: stale }),
      /14 days/,
    );
  });
  it("refuses a block with no weight, zero, negative or kilogram-sized tons", async () => {
    const { asOwner } = await staffFactory("tons");
    const receive = (weightTons: unknown, serial: string) =>
      inventory.receiveBlock(asOwner, { serialNumber: serial, varietyName: "Grey", clientOpId: `tons-${serial}`, weightTons: weightTons as number });
    await assert.rejects(() => receive(undefined, "T0"), /weightTons is required/);
    await assert.rejects(() => receive(0, "T1"), /more than 0/);
    await assert.rejects(() => receive(-5, "T2"), /more than 0/);
    await assert.rejects(() => receive(18000, "T3"), /kg vs tons/);
    await assert.rejects(
      () => inventory.receiveBlock(asOwner, { serialNumber: "T4", varietyName: "Grey", clientOpId: "tons-T4", weightTons: 18, actualAmountPaid: -1 }),
      /actualAmountPaid cannot be negative/,
    );
    const ok = (await receive(18.5, "T5")) as { block: { weightTons: unknown } };
    assert.equal(Number(ok.block.weightTons), 18.5);

    const snapshot = await inventory.startOpeningCount(asOwner);
    await assert.rejects(
      () => inventory.addOpeningLine(asOwner, snapshot.id, "RAW_BLOCK", { serialNumber: "OT1", varietyName: "Grey", weightTons: "0" }),
      /more than 0/,
    );
  });

  it("answers a duplicate consumable with 409 and refuses units that cannot be summed", async () => {
    const { asOwner } = await staffFactory("cons");
    const consumables = new ConsumablesController(prisma as never);
    await consumables.create(asOwner, { name: "Epoxy resin", unit: "litre" });
    await assert.rejects(
      () => consumables.create(asOwner, { name: "Epoxy resin", unit: "litre" }),
      (error: { status?: number; response?: { code?: string } }) =>
        error.status === 409 && error.response?.code === "CONSUMABLE_EXISTS",
    );
    await assert.rejects(() => consumables.create(asOwner, { name: "Grout", unit: "bucket" }), /piece, litre/);
    await assert.rejects(() => consumables.create(asOwner, { name: "Blades", unit: "piece", onHand: -3 }), /negative/);
    const blades = await consumables.create(asOwner, { name: "  Blades  ", unit: "piece", onHand: 12 });
    assert.equal(blades.name, "Blades");
  });

  it("refuses money, sales and attendance dated after today", async () => {
    const { factory, asOwner } = await staffFactory("future");
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await assert.rejects(
      () => expenses.create(asOwner, { category: "other", amount: 100, expenseDate: tomorrow, clientOpId: "fut-exp" }),
      /expenseDate cannot be after today/,
    );
    const customer = await sales.createCustomer(asOwner, "Future Buyer");
    await assert.rejects(
      () => sales.createOrder(asOwner, { customerId: customer.id, orderDate: tomorrow, clientOpId: "fut-order", lines: [{ quantitySqft: 10, rate: 100 }] }),
      /orderDate cannot be after today/,
    );
    const order = (await sales.createOrder(asOwner, {
      customerId: customer.id,
      orderDate: currentFactoryDate(),
      clientOpId: "fut-order-ok",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "fut-inv");
    await assert.rejects(
      () => sales.pay(asOwner, invoice.id, { amount: 10, method: "cash", paidAt: tomorrow, clientOpId: "fut-pay" }),
      /paidAt cannot be after today/,
    );
    const worker = await muster.createWorker(asOwner, { name: "Future Hand", dailyWage: 500 });
    await assert.rejects(
      () => muster.mark(asOwner, { workerId: worker.id, date: tomorrow, status: "present" }),
      /date cannot be after today/,
    );
    assert.equal(await prisma.payment.count({ where: { factoryId: factory.id } }), 0);
  });

  it("counts month-to-date inside this IST month only", async () => {
    const { factory, asOwner } = await staffFactory("mtd");
    const today = currentFactoryDate();
    const [y, m] = today.split("-").map(Number);
    const lastOfPrevious = new Date(Date.UTC(y!, m! - 1, 0)).toISOString().slice(0, 10);
    const firstOfNext = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
    await expenses.create(asOwner, { category: "other", amount: 100, expenseDate: today, clientOpId: "mtd-now" });
    await expenses.create(asOwner, { category: "other", amount: 7, expenseDate: lastOfPrevious, clientOpId: "mtd-prev" });
    // A row from before this rule existed, dated into next month: never "this month".
    await prisma.expense.create({
      data: { factoryId: factory.id, category: "other", amount: 50_000, expenseDate: new Date(`${firstOfNext}T00:00:00Z`) },
    });
    const brief = await reports.ceoBrief(factory.id);
    assert.equal(brief.expensesMtd, 100, "neither last month's final day nor next month's rows count");
  });
  it("Today and Money include unpaid invoices even if historical vouchers are missing",async()=>{
    const {factory,asOwner}=await staffFactory("unposted-ar");
    const customer=await sales.createCustomer(asOwner,"Unposted customer");
    const order=await sales.createOrder(asOwner,{customerId:customer.id,orderDate:currentFactoryDate(),clientOpId:"unposted-order",lines:[{quantitySqft:10,rate:100}]}) as {id:string};
    const invoice=await prisma.invoice.create({data:{factoryId:factory.id,salesOrderId:order.id,customerId:customer.id,invoiceNumber:"LEGACY-1",amount:1000,idempotencyKey:"legacy-invoice"}});
    await prisma.payment.create({data:{factoryId:factory.id,invoiceId:invoice.id,amount:250,paidAt:new Date(currentFactoryDate()),method:"cash",idempotencyKey:"legacy-pay"}});
    assert.equal((await reports.ceoBrief(factory.id)).outstandingAr,750);
    assert.equal((await books.outstanding(factory.id)).youllGet,750);
    assert.equal(await prisma.voucher.count({where:{factoryId:factory.id}}),0,"report reads do not repair live data by writing vouchers");
  });
  it("Money includes unpaid receipts and supplier opening credits",async()=>{
    const {factory,asOwner}=await staffFactory("supplier-balances");
    const supplier=await inventory.createSupplier(asOwner,"Supplier one");
    await inventory.receiveBlock(asOwner,{serialNumber:"VG-12",varietyName:"Tan Brown",weightTons:10,supplierId:supplier.id,invoicedAmount:1000,actualAmountPaid:200,clientOpId:"legacy-receipt"});
    assert.equal((await books.outstanding(factory.id)).youllGive,800);
  });
  it("preserves 2027 financial history and refuses early maintenance completion",async()=>{
    const {factory,asOwner}=await staffFactory("history-2027");
    const expense=await prisma.expense.create({data:{factoryId:factory.id,expenseDate:new Date("2027-01-10"),category:"maintenance",amount:400}});
    const machine=await prisma.machine.findFirstOrThrow({where:{factoryId:factory.id}});
    const jobs=new MaintenanceService(prisma as never,new AuditService(prisma as never));
    const future=await jobs.create(asOwner,{machineId:machine.id,title:"2027 service",dueOn:"2027-01-10"});
    await assert.rejects(()=>jobs.complete(asOwner,future.id),/not due yet/);
    assert.ok((await jobs.list(factory.id)).some(j=>j.id===future.id));
    assert.ok((await expenses.list(factory.id)).some(e=>e.id===expense.id));
    assert.equal((await prisma.maintenanceJob.findUniqueOrThrow({where:{id:future.id}})).completedAt,null);
  });
  it("issues only the three daily roles while preserving existing legacy rows",async()=>{
    const {asOwner}=await staffFactory("three-roles");
    for(const role of ["manager","admin","inventory","sales","accountant","auditor"]) await assert.rejects(()=>users.provision(asOwner,{username:`new-${role}`,role}),/cannot be provisioned/);
    for(const role of ["owner","supervisor","operator"]) assert.equal((await users.provision(asOwner,{username:`new-${role}`,role})).user.role,role);
  });


  /**
   * Seed one operational day's work. Timestamps are set explicitly rather than
   * left to now(), because what these tests are checking is precisely which day a
   * record lands on.
   */
  async function seedDay(factoryId: string, day: string) {
    const at = (istHour: number, istMinute = 0) =>
      new Date(Date.parse(`${day}T00:00:00+05:30`) + (istHour * 60 + istMinute) * 60_000);

    const machine = await prisma.machine.findFirstOrThrow({
      where: { factoryId, machineType: "CUTTING" },
    });
    const block = await prisma.rawBlock.create({
      data: {
        factoryId,
        serialNumber: `DPR-${day}`,
        varietyName: "Tan Brown",
        weightTons: "20",
        purchaseDate: new Date(`${day}T00:00:00Z`),
      },
    });
    const session = await prisma.cuttingSession.create({
      data: {
        factoryId,
        rawBlockId: block.id,
        machineId: machine.id,
        startedAt: at(8),
        endedAt: at(17),
        status: "COMPLETED",
        damagedSlabCount: 2,
        dayLogs: {
          create: {
            operationalDate: new Date(`${day}T00:00:00Z`),
            runtimeHours: "9.5",
            downtimeMinutes: 30,
            powerConsumptionKwh: "412.75",
            slabsProducedCount: 50,
          },
        },
      },
    });

    // Three slabs: two in the day shift, one cut at 02:00 the following morning,
    // which is still this operational day's work.
    const slabs = [];
    for (const [index, when] of [at(10), at(14), at(26)].entries()) {
      slabs.push(
        await prisma.slab.create({
          data: {
            factoryId,
            parentBlockId: block.id,
            cuttingSessionId: session.id,
            slabSerial: `${day}-S${index}`,
            varietyName: "Tan Brown",
            lengthFt: "8",
            widthFt: "5",
            createdAt: when,
          },
        }),
      );
    }
    return { block, session, slabs, at };
  }


  /** A received block, priced with both a billed leg and a cash leg. */
  async function receiveBlock(
    factoryId: string,
    serial: string,
    opts: { taxable?: number; cash?: number; variety?: string } = {},
  ) {
    return prisma.rawBlock.create({
      data: {
        factoryId,
        serialNumber: serial,
        varietyName: opts.variety ?? "Imperial Red",
        weightTons: "22.000",
        purchaseTaxable: String(opts.taxable ?? 220_000),
        purchaseCashAmount: String(opts.cash ?? 220_000),
        purchaseGstRatePct: "5",
        purchaseCgst: "5500",
        purchaseSgst: "5500",
      },
    });
  }

  it("counts a lot through cutting, breakage and sale the way the yard does", async () => {
    const { factory, asOwner } = await staffFactory("lot");
    await receiveBlock(factory.id, "VG-001");

    // 96 off the saw, 6 broke on it. The 6 never reached stock.
    const cut = await lots.recordCut(asOwner, {
      blockSerial: "VG-001",
      totalSlabsCut: 96,
      damagedAtSaw: 6,
      sqftPerSlab: 49.5,
      clientOpId: "lot-cut-1",
    });
    assert.equal(cut.goodSlabCount, 90);
    assert.equal(cut.availableSlabs, 90);
    assert.equal(cut.availableSqft, 4455);

    // The stock screen: one line per lot, no piece list.
    const stock = await lots.availability(factory.id);
    assert.equal(stock.lots.length, 1);
    assert.equal(stock.lots[0]!.blockSerial, "VG-001");
    assert.equal(stock.lots[0]!.availableSlabs, 90);
    assert.equal(stock.totalAvailableSqft, 4455);

    // 3 broken moving them across the yard.
    const off = await lots.writeOffBroken(asOwner, {
      blockSerial: "VG-001",
      slabCount: 3,
      stage: "factory_transport",
      reason: "forklift tilted the A-frame",
      clientOpId: "lot-off-1",
    });
    assert.equal(off.availableSlabs, 87);
    // 4,40,000 of cost over 90 good slabs, three of them gone.
    assert.equal(off.costAmount, Math.round((440_000 / 90) * 3 * 100) / 100);

    // Sell 75 and the owner's example closes: 90 - 3 - 75 = 12.
    const customer = await sales.createCustomer(asOwner, "Sharma Marbles Jaipur");
    await lots.sellLots(asOwner, {
      customerId: customer.id,
      lines: [{ blockSerial: "VG-001", slabCount: 75, rate: 85 }],
      clientOpId: "lot-sell-1",
    });
    const after = await prisma.rawBlock.findFirstOrThrow({
      where: { factoryId: factory.id, serialNumber: "VG-001" },
    });
    assert.equal(after.goodSlabCount - after.brokenSlabCount - after.soldSlabCount, 12);
  });

  it("refuses to sell more slabs than the lot holds, naming both numbers", async () => {
    const { factory, asOwner } = await staffFactory("lotover");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 96, damagedAtSaw: 6, sqftPerSlab: 49.5,
      clientOpId: "ov-cut",
    });
    await lots.writeOffBroken(asOwner, {
      blockSerial: "VG-001", slabCount: 3, stage: "yard", reason: "chipped",
      clientOpId: "ov-off",
    });
    await lots.sellLots(asOwner, {
      customerId: (await sales.createCustomer(asOwner, "Buyer")).id,
      lines: [{ blockSerial: "VG-001", slabCount: 75, rate: 85 }],
      clientOpId: "ov-sell",
    });

    const second = await sales.createCustomer(asOwner, "Buyer 2");
    await assert.rejects(
      () =>
        lots.sellLots(asOwner, {
          customerId: second.id,
          lines: [{ blockSerial: "VG-001", slabCount: 100, rate: 85 }],
          clientOpId: "ov-sell-2",
        }),
      /VG-001 has 12 slabs available/,
    );
    // And nothing was deducted by the attempt.
    const block = await prisma.rawBlock.findFirstOrThrow({
      where: { factoryId: factory.id, serialNumber: "VG-001" },
    });
    assert.equal(block.soldSlabCount, 75);
  });

  it("bills several lots on one invoice, with the HSN summary and both addresses", async () => {
    const { factory, asOwner } = await staffFactory("lotbill");
    await gst.upsertProfile(asOwner, { gstin: "08AAUFV3603N1ZH", stateCode: "08", legalName: "Vedam Granites" });
    await receiveBlock(factory.id, "VG-101", { variety: "Imperial Red" });
    await receiveBlock(factory.id, "VG-102", { variety: "Kashmir White" });
    for (const serial of ["VG-101", "VG-102"]) {
      await lots.recordCut(asOwner, {
        blockSerial: serial, totalSlabsCut: 96, damagedAtSaw: 6, sqftPerSlab: 10,
        clientOpId: `bill-cut-${serial}`,
      });
    }
    const customer = await prisma.customer.create({
      data: {
        factoryId: factory.id, name: "Sharma Marbles", stateCode: "08",
        gstin: "08AABCS1429B1ZX", billingAddress: "MI Road, Jaipur",
      },
    });

    // 80 from one lot, 70 from another, invoiced together.
    const order = await lots.sellLots(asOwner, {
      customerId: customer.id,
      lines: [
        { blockSerial: "VG-101", slabCount: 80, rate: 100 },
        { blockSerial: "VG-102", slabCount: 70, rate: 100 },
      ],
      clientOpId: "bill-sell",
    });
    assert.equal(order.lines.length, 2);
    assert.equal(order.taxableAmount, 80 * 10 * 100 + 70 * 10 * 100);

    const bill = await lots.invoiceOrder(asOwner, {
      orderId: order.orderId,
      clientOpId: "bill-inv",
      invoiceDate: "2026-09-30",
      shipTo: { name: "Sharma site store", address: "Sitapura, Jaipur", stateCode: "08" },
    });
    assert.match(bill.invoiceNumber, /^INV-/);
    assert.equal(bill.invoiceDate,"2026-09-30");
    assert.equal((await prisma.voucher.findFirstOrThrow({where:{factoryId:factory.id,source:"sales_invoice"}})).operationalDate.toISOString().slice(0,10),"2026-09-30");
    assert.equal(bill.seller.gstin, "08AAUFV3603N1ZH");
    assert.equal(bill.billTo.name, "Sharma Marbles");
    assert.equal(bill.billTo.address, "MI Road, Jaipur");
    assert.equal(bill.shipTo.name, "Sharma site store", "consignee may differ from the buyer");
    assert.equal(bill.items.length, 2);
    assert.deepEqual(bill.items.map((i) => i.blockSerial).sort(), ["VG-101", "VG-102"]);
    assert.equal(bill.items[0]!.hsnCode, "6802");

    // One HSN row, both lines inside it, 18% on the whole taxable value.
    assert.equal(bill.hsnSummary.length, 1);
    assert.equal(bill.hsnSummary[0]!.taxableAmount, 150_000);
    assert.equal(bill.totals.taxableAmount, 150_000);
    assert.equal(bill.totals.cgstAmount + bill.totals.sgstAmount, 27_000);
    assert.equal(bill.totals.igstAmount, 0, "same state, so no IGST");
    assert.equal(bill.totals.payable, 177_000);
  });

  it("carries two HSN rates on one bill and still adds up", async () => {
    const { factory, asOwner } = await staffFactory("lotmix");
    await gst.upsertProfile(asOwner, { gstin: "08AAUFV3603N1ZH", stateCode: "08", legalName: "Vedam" });
    await receiveBlock(factory.id, "VG-201");
    await receiveBlock(factory.id, "VG-202");
    for (const serial of ["VG-201", "VG-202"]) {
      await lots.recordCut(asOwner, {
        blockSerial: serial, totalSlabsCut: 11, damagedAtSaw: 1, sqftPerSlab: 10,
        clientOpId: `mix-cut-${serial}`,
      });
    }
    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "AP Stone House", stateCode: "37" },
    });
    const order = await lots.sellLots(asOwner, {
      customerId: customer.id,
      lines: [
        { blockSerial: "VG-201", slabCount: 10, rate: 1_000 },
        // Rough blocks are HSN 2516 at 5%, sold off the same order.
        { blockSerial: "VG-202", slabCount: 10, rate: 500, hsnCode: "2516", gstRatePct: 5 },
      ],
      clientOpId: "mix-sell",
    });
    const bill = await lots.invoiceOrder(asOwner, { orderId: order.orderId, clientOpId: "mix-inv" });

    assert.equal(bill.hsnSummary.length, 2, "one row per HSN and rate");
    const slab = bill.hsnSummary.find((h) => h.hsnCode === "6802")!;
    const block = bill.hsnSummary.find((h) => h.hsnCode === "2516")!;
    assert.equal(slab.taxableAmount, 100_000);
    assert.equal(slab.igstAmount, 18_000, "inter-state, so IGST");
    assert.equal(block.taxableAmount, 50_000);
    assert.equal(block.igstAmount, 2_500);
    // The whole bill is the sum of its parts, to the paisa.
    assert.equal(bill.totals.taxableAmount, 150_000);
    assert.equal(bill.totals.igstAmount, 20_500);
    assert.equal(bill.totals.payable, 170_500);
  });

  it("prices a block from both legs of the purchase, and books the cash one", async () => {
    const { factory, asOwner } = await staffFactory("buycash");
    await gst.upsertProfile(asOwner, {
      gstin: "08ZZZZZ0000Z1ZX", stateCode: "08", legalName: "Test Granites",
    });
    // 2,00,000 on the bill plus 50,000 in cash. The cash carries no GST, so there is
    // no input credit on it — but it is still what the stone cost.
    const received = await inventory.receiveBlock(asOwner, {
      serialNumber: "VG-900",
      varietyName: "Imperial Red",
      weightTons: 20,
      purchaseTaxable: 200_000,
      purchaseCashAmount: 50_000,
      clientOpId: "buy-cash-1",
    });
    const blockId = (received as { block: { id: string } }).block.id;
    const stored = await prisma.rawBlock.findUniqueOrThrow({ where: { id: blockId } });
    assert.equal(Number(stored.purchaseTaxable), 200_000);
    assert.equal(Number(stored.purchaseCashAmount), 50_000);
    // The vendor is owed only the bill: 2,00,000 + 5% = 2,10,000. The cash is gone.
    assert.equal(Number(stored.invoicedAmount), 210_000);

    const tb = await books.trialBalance(factory.id);
    const debits = tb.reduce((sum, row) => sum + row.debit, 0);
    const credits = tb.reduce((sum, row) => sum + row.credit, 0);
    assert.equal(Math.round(debits * 100), Math.round(credits * 100), "books must balance");
    // Both legs are stock; only the billed leg created a payable and input credit.
    assert.equal(tb.find((row) => row.code === "STOCK")!.debit, 250_000);
    assert.equal(tb.find((row) => row.code === "AP")!.credit, 210_000);
    assert.equal(tb.find((row) => row.code === "CASH")!.credit, 50_000);
    assert.equal(tb.find((row) => row.code === "GST_INPUT_CGST")!.debit, 5_000);

    // And the cost basis the write-off valuation uses is both legs over the good slabs.
    await lots.recordCut(asOwner, {
      blockSerial: "VG-900", totalSlabsCut: 100, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "buy-cash-cut",
    });
    const off = await lots.writeOffBroken(asOwner, {
      blockSerial: "VG-900", slabCount: 2, stage: "yard",
      reason: "cracked in the stack", clientOpId: "buy-cash-off",
    });
    // 2,50,000 over 100 slabs is 2,500 each, not the 2,000 the bill alone would give.
    assert.equal(off.costAmount, 5_000);
  });

  it("takes part of a lot sale in cash and leaves it off the bill, not off the books", async () => {
    const { factory, asOwner } = await staffFactory("sellcash");
    await gst.upsertProfile(asOwner, {
      gstin: "08ZZZZZ0000Z1ZX", stateCode: "08", legalName: "Test Granites",
    });
    await receiveBlock(factory.id, "VG-001", { taxable: 100_000, cash: 0 });
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 100, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "sc-cut",
    });
    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "Part Cash Traders", stateCode: "08" },
    });

    // 50 slabs x 10 sqft x 80 = 40,000 billed, plus 15,000 in cash.
    const order = await lots.sellLots(asOwner, {
      customerId: customer.id,
      clientOpId: "sc-sell",
      cashAmount: 15_000,
      cashNote: "balance settled at the gate",
      lines: [{ blockSerial: "VG-001", slabCount: 50, rate: 80 }],
    });
    assert.equal(order.taxableAmount, 40_000);
    assert.equal(order.cashAmount, 15_000);
    assert.equal(order.billingMode, "gst_invoice");

    // The bill carries the billed leg only.
    const bill = await lots.invoiceOrder(asOwner, { orderId: order.orderId, clientOpId: "sc-inv" });
    assert.equal(bill.totals.taxableAmount, 40_000);
    assert.equal(bill.totals.payable, 47_200);

    // The cash is on its own ledger, so turnover on SALES still reconciles to the
    // invoices and the books still balance.
    const tb = await books.trialBalance(factory.id);
    const debits = tb.reduce((sum, row) => sum + row.debit, 0);
    const credits = tb.reduce((sum, row) => sum + row.credit, 0);
    assert.equal(Math.round(debits * 100), Math.round(credits * 100), "books must balance");
    assert.equal(tb.find((row) => row.code === "SALES")!.credit, 40_000);
    assert.equal(tb.find((row) => row.code === "SALES_UNBILLED")!.credit, 15_000);

    // And the return reports it as excluded rather than silently dropping it.
    const month = new Date().toISOString().slice(0, 7);
    const gstr = await gst.gstr1(factory.id, month);
    assert.equal(gstr.totals.taxable, 40_000);
    assert.equal(gstr.excludedCashSales.count, 1);
    assert.equal(gstr.excludedCashSales.amount, 15_000);
    const report = await new PartyReportService(prisma as never).report(factory.id, {side: "customer"});
    assert.equal(report.totals.charges, 62_200);
    assert.equal(report.totals.received, 15_000);
    assert.equal(report.summary[0]?.due, 47_200);
    assert.equal(report.rows.filter(r => r.type === "Sale").length, 2);
  });

  it("refuses to invoice a lot sale that was taken wholly in cash", async () => {
    const { factory, asOwner } = await staffFactory("allcash");
    await receiveBlock(factory.id, "VG-001", { taxable: 100_000, cash: 0 });
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 100, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "ac-cut",
    });
    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "Counter Buyer", stateCode: "08" },
    });
    const order = await lots.sellLots(asOwner, {
      customerId: customer.id,
      clientOpId: "ac-sell",
      cashAmount: 60_000,
      lines: [{ blockSerial: "VG-001", slabCount: 20, rate: 0 }],
    });
    assert.equal(order.billingMode, "cash_unbilled");
    assert.equal(order.cashAmount, 60_000);
    const report = await new PartyReportService(prisma as never).report(factory.id, {side: "customer"});
    assert.equal(report.totals.charges, 60_000);
    assert.equal(report.totals.received, 60_000);
    assert.equal(report.summary[0]?.due, 0);
    assert.equal(report.rows.find(r => r.type === "Payment received")?.mode, "cash");
    // Stock still left the yard.
    assert.equal((await lots.availability(factory.id)).lots[0]!.availableSlabs, 80);
    await assert.rejects(
      () => lots.invoiceOrder(asOwner, { orderId: order.orderId, clientOpId: "ac-inv" }),
      /taken in cash with no bill/,
    );
    // A sale for nothing at all is still refused.
    await assert.rejects(
      () =>
        lots.sellLots(asOwner, {
          customerId: customer.id,
          clientOpId: "ac-nothing",
          lines: [{ blockSerial: "VG-001", slabCount: 1, rate: 0 }],
        }),
      /a cash amount/,
    );
  });

  it("sends a count off a lot through the line without moving the stock", async () => {
    const { factory, asOwner } = await staffFactory("polishlot");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 70, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "pl-cut",
    });
    const lpm = await prisma.machine.findFirstOrThrow({
      where: { factoryId: factory.id, machineType: "POLISHING" },
    });

    // The lot reads VG-001-70 before anything happens to it.
    const before = (await lots.availability(factory.id)).lots[0]!;
    assert.equal(before.label, "VG-001-70");
    assert.equal(before.unpolishedSlabs, 70);
    assert.equal(before.polishedSlabCount, 0);

    const run = await lots.polishLot(asOwner, {
      blockSerial: "VG-001",
      slabCount: 50,
      machineId: lpm.id,
      processType: "POLISHING",
      finishType: "mirror",
      runtimeHours: 7.5,
      clientOpId: "pl-run",
    });
    assert.equal(run.slabCount, 50);
    assert.equal(run.polishedSlabCount, 50);
    assert.equal(run.unpolishedSlabs, 20);
    // Polishing changes what a slab is, not whether the yard has it.
    assert.equal(run.availableSlabs, 70);
    assert.equal(run.label, "VG-001-70");

    // Resending the same run does not put the slabs through twice.
    const replay = await lots.polishLot(asOwner, {
      blockSerial: "VG-001", slabCount: 50, machineId: lpm.id,
      processType: "POLISHING", clientOpId: "pl-run",
    });
    assert.equal(replay.sessionId, run.sessionId);
    assert.equal(replay.polishedSlabCount, 50);

    // Only 20 are left unfinished, so 21 is refused.
    await assert.rejects(
      () =>
        lots.polishLot(asOwner, {
          blockSerial: "VG-001", slabCount: 21, machineId: lpm.id,
          processType: "POLISHING", clientOpId: "pl-over",
        }),
      /has 20 unpolished slabs, so 21 cannot go through/,
    );

    // Grinding is a stage on the way, so it does not count as finished.
    await lots.polishLot(asOwner, {
      blockSerial: "VG-001", slabCount: 20, machineId: lpm.id,
      processType: "GRINDING", clientOpId: "pl-grind",
    });
    const after = (await lots.availability(factory.id)).lots[0]!;
    assert.equal(after.polishedSlabCount, 50);
    assert.equal(after.unpolishedSlabs, 20);
  });

  it("shows the lot shrinking as it sells, and keeps the polished tally", async () => {
    const { factory, asOwner } = await staffFactory("lotlabel");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 70, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "ll-cut",
    });
    const lpm = await prisma.machine.findFirstOrThrow({
      where: { factoryId: factory.id, machineType: "POLISHING" },
    });
    await lots.polishLot(asOwner, {
      blockSerial: "VG-001", slabCount: 70, machineId: lpm.id,
      processType: "POLISHING", clientOpId: "ll-polish",
    });
    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "Label Buyer", stateCode: "08" },
    });
    await lots.sellLots(asOwner, {
      customerId: customer.id,
      clientOpId: "ll-sell",
      lines: [{ blockSerial: "VG-001", slabCount: 50, rate: 90 }],
    });

    // The whole of the user's example: VG-001-70, sell 50, balance reads VG-001-20.
    const lot = (await lots.availability(factory.id)).lots[0]!;
    assert.equal(lot.label, "VG-001-20");
    assert.equal(lot.availableSlabs, 20);
    // All 70 were finished before any went out, so nothing is left to polish.
    assert.equal(lot.polishedSlabCount, 70);
    assert.equal(lot.unpolishedSlabs, 0);
  });

  it("counts a lot polishing run as its slabs, not as one row", async () => {
    const { factory, asOwner } = await staffFactory("polishday");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 70, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "pd-cut",
    });
    const lpm = await prisma.machine.findFirstOrThrow({
      where: { factoryId: factory.id, machineType: "POLISHING" },
    });
    // Ground first, then polished: the same fifty through twice. Only the polishing
    // stage may be counted, or the day would report a hundred slabs finished.
    await lots.polishLot(asOwner, {
      blockSerial: "VG-001", slabCount: 50, machineId: lpm.id,
      processType: "GRINDING", clientOpId: "pd-grind",
    });
    await lots.polishLot(asOwner, {
      blockSerial: "VG-001", slabCount: 50, machineId: lpm.id,
      processType: "POLISHING", runtimeHours: 8, clientOpId: "pd-polish",
    });

    const figures = await dailyReports.dailyFigures(factory.id);
    assert.equal(figures.polishing.sessions, 2);
    assert.equal(figures.polishing.slabsPolished, 50);
    assert.equal(figures.polishing.sqftPolished, 500);
  });

  it("puts the cash leg on an older block and posts only the difference", async () => {
    const { factory, asOwner } = await staffFactory("fixcash");
    // Received the way every block before today was: billed leg only.
    await receiveBlock(factory.id, "VG-OLD", { taxable: 200_000, cash: 0 });
    await lots.recordCut(asOwner, {
      blockSerial: "VG-OLD", totalSlabsCut: 100, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "fx-cut",
    });

    const fixed = await inventory.correctPurchaseCash(asOwner, {
      blockSerial: "VG-OLD",
      purchaseCashAmount: 50_000,
      reason: "cash leg was never entered at receipt",
      clientOpId: "fx-1",
    });
    assert.equal(fixed.previousCashAmount, 0);
    assert.equal(fixed.purchaseCashAmount, 50_000);
    assert.equal(fixed.costBasis, 250_000);
    assert.equal(fixed.costPerSlab, 2_500);

    // Posted as stock bought for cash, and the books still balance.
    let tb = await books.trialBalance(factory.id);
    assert.equal(
      Math.round(tb.reduce((n, r) => n + r.debit, 0) * 100),
      Math.round(tb.reduce((n, r) => n + r.credit, 0) * 100),
      "a correction must not unbalance the ledger",
    );
    // receiveBlock here writes the row directly and posts no purchase voucher, so
    // STOCK carries this correction and nothing else.
    assert.equal(tb.find((r) => r.code === "CASH")!.credit, 50_000);
    assert.equal(tb.find((r) => r.code === "STOCK")!.debit, 50_000);

    // Correcting again posts only the difference, not the whole amount again.
    const again = await inventory.correctPurchaseCash(asOwner, {
      blockSerial: "VG-OLD",
      purchaseCashAmount: 60_000,
      reason: "found another 10k in the khata",
      clientOpId: "fx-2",
    });
    assert.equal(again.previousCashAmount, 50_000);
    tb = await books.trialBalance(factory.id);
    assert.equal(tb.find((r) => r.code === "CASH")!.credit, 60_000);
    assert.equal(tb.find((r) => r.code === "STOCK")!.debit, 60_000);

    // And a correction downwards reverses rather than posting a negative.
    await inventory.correctPurchaseCash(asOwner, {
      blockSerial: "VG-OLD",
      purchaseCashAmount: 40_000,
      reason: "double counted the advance",
      clientOpId: "fx-3",
    });
    tb = await books.trialBalance(factory.id);
    assert.equal(tb.find((r) => r.code === "CASH")!.credit, 60_000);
    assert.equal(tb.find((r) => r.code === "CASH")!.debit, 20_000);
    assert.equal(tb.find((r) => r.code === "STOCK")!.credit, 20_000, "reversed, not negative");
    assert.equal(
      Math.round(tb.reduce((n, r) => n + r.debit, 0) * 100),
      Math.round(tb.reduce((n, r) => n + r.credit, 0) * 100),
    );

    // The corrected basis is what a write-off is valued at from now on.
    const off = await lots.writeOffBroken(asOwner, {
      blockSerial: "VG-OLD", slabCount: 2, stage: "yard",
      reason: "cracked", clientOpId: "fx-off",
    });
    assert.equal(off.costAmount, 4_800, "240000 over 100 slabs is 2400 each");
  });

  it("refuses a cash correction with no reason, and replays as one", async () => {
    const { factory, asOwner } = await staffFactory("fixguard");
    await receiveBlock(factory.id, "VG-OLD", { taxable: 100_000, cash: 0 });

    await assert.rejects(
      () =>
        inventory.correctPurchaseCash(asOwner, {
          blockSerial: "VG-OLD", purchaseCashAmount: 1_000, reason: "   ",
          clientOpId: "g-1",
        }),
      /why the cash amount is being changed/,
    );
    await assert.rejects(
      () =>
        inventory.correctPurchaseCash(asOwner, {
          blockSerial: "VG-OLD", purchaseCashAmount: -5, reason: "typo",
          clientOpId: "g-2",
        }),
      /cannot be negative/,
    );
    await assert.rejects(
      () =>
        inventory.correctPurchaseCash(asOwner, {
          blockSerial: "NOPE", purchaseCashAmount: 10, reason: "x", clientOpId: "g-3",
        }),
      /No block NOPE/,
    );

    // A resent correction must not post the difference twice.
    const first = await inventory.correctPurchaseCash(asOwner, {
      blockSerial: "VG-OLD", purchaseCashAmount: 25_000, reason: "khata entry",
      clientOpId: "g-ok",
    });
    const replay = await inventory.correctPurchaseCash(asOwner, {
      blockSerial: "VG-OLD", purchaseCashAmount: 25_000, reason: "khata entry",
      clientOpId: "g-ok",
    });
    assert.deepEqual(replay, first);
    const tb = await books.trialBalance(factory.id);
    assert.equal(tb.find((r) => r.code === "CASH")!.credit, 25_000);
  });

  it("keeps a buyer's GSTIN, addresses and state, and refuses a malformed one", async () => {
    const { factory, asOwner } = await staffFactory("cust");

    const buyer = await sales.createCustomer(asOwner, "Sharma Marbles", "9876543210", {
      gstin: "08aabcs1429b1zx",
      billingAddress: "MI Road, Jaipur",
      shippingAddress: "Sitapura site store",
    });
    assert.equal(buyer.gstin, "08AABCS1429B1ZX", "upper-cased on the way in");
    // The state is read off the GSTIN, never asked for twice.
    assert.equal(buyer.stateCode, "08");
    assert.equal(buyer.billingAddress, "MI Road, Jaipur");
    assert.equal(buyer.shippingAddress, "Sitapura site store");
    assert.equal(buyer.contactInfo, "9876543210");

    // A GSTIN one character short used to be stored as typed, and every bill to that
    // buyer went out with it.
    await assert.rejects(
      () => sales.createCustomer(asOwner, "Typo Traders", undefined, { gstin: "08AABCS1429B1Z" }),
      /must be 15 characters in the GST format/,
    );
    // A typed state that contradicts the GSTIN would route tax to the wrong heads.
    await assert.rejects(
      () =>
        sales.createCustomer(asOwner, "Wrong State", undefined, {
          gstin: "08AABCS1429B1ZX", stateCode: "37",
        }),
      /contradicts GSTIN/,
    );
    await assert.rejects(() => sales.createCustomer(asOwner, "   "), /needs a name/);

    // No GSTIN is a legitimate answer for a counter buyer.
    const counter = await sales.createCustomer(asOwner, "Counter Buyer", undefined, {
      gstin: "", stateCode: "8",
    });
    assert.equal(counter.gstin, null);
    assert.equal(counter.stateCode, "08", "8 and 08 are the same state");
    assert.equal(
      (await prisma.customer.count({ where: { factoryId: factory.id } })),
      2,
      "the three refusals saved nothing",
    );
  });

  it("bills an out-of-state buyer IGST off the GSTIN the customer form captured", async () => {
    const { factory, asOwner } = await staffFactory("custigst");
    await gst.upsertProfile(asOwner, {
      gstin: "08ZZZZZ0000Z1ZX", stateCode: "08", legalName: "Test Granites",
    });
    await receiveBlock(factory.id, "VG-001", { taxable: 100_000, cash: 0 });
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 100, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "ig-cut",
    });
    // Andhra Pradesh is state 37. Saved with only a name, this buyer would have been
    // billed CGST+SGST as though the stone never left Rajasthan.
    const buyer = await sales.createCustomer(asOwner, "Vizag Stones", undefined, {
      gstin: "37AABCS1429B1ZX", billingAddress: "Vizag",
    });
    const order = await lots.sellLots(asOwner, {
      customerId: buyer.id,
      clientOpId: "ig-sell",
      lines: [{ blockSerial: "VG-001", slabCount: 50, rate: 80 }],
    });
    const bill = await lots.invoiceOrder(asOwner, {
      orderId: order.orderId, clientOpId: "ig-inv",
    });
    assert.equal(bill.interState, true);
    assert.equal(bill.placeOfSupply, "37");
    assert.equal(bill.totals.igstAmount, 7_200, "18% as IGST");
    assert.equal(bill.totals.cgstAmount, 0);
    assert.equal(bill.totals.sgstAmount, 0);
    assert.equal(bill.billTo.gstin, "37AABCS1429B1ZX");
    assert.equal(bill.billTo.address, "Vizag");
  });

  it("adds a GSTIN to a buyer who never had one, and bills them IGST after", async () => {
    const { factory, asOwner } = await staffFactory("custedit");
    await gst.upsertProfile(asOwner, {
      gstin: "08ZZZZZ0000Z1ZX", stateCode: "08", legalName: "Test Granites",
    });
    await receiveBlock(factory.id, "VG-001", { taxable: 100_000, cash: 0 });
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 100, damagedAtSaw: 0, sqftPerSlab: 10,
      clientOpId: "ce-cut",
    });

    // The way every buyer added before the form captured one looks.
    const buyer = await sales.createCustomer(asOwner, "Vizag Stones");
    assert.equal(buyer.gstin, null);
    assert.equal(buyer.stateCode, null);

    const fixed = await sales.updateCustomer(asOwner, buyer.id, {
      gstin: "37aabcs1429b1zx",
      billingAddress: "Beach Road, Vizag",
    });
    assert.equal(fixed.gstin, "37AABCS1429B1ZX");
    assert.equal(fixed.stateCode, "37", "the state follows the GSTIN");
    assert.equal(fixed.name, "Vizag Stones", "an unmentioned field is left alone");
    assert.equal(fixed.billingAddress, "Beach Road, Vizag");

    // And the next bill is IGST, which it would not have been before the edit.
    const order = await lots.sellLots(asOwner, {
      customerId: buyer.id, clientOpId: "ce-sell",
      lines: [{ blockSerial: "VG-001", slabCount: 50, rate: 80 }],
    });
    const bill = await lots.invoiceOrder(asOwner, {
      orderId: order.orderId, clientOpId: "ce-inv",
    });
    assert.equal(bill.interState, true);
    assert.equal(bill.totals.igstAmount, 7_200);
    assert.equal(bill.totals.cgstAmount, 0);

    const logged = await prisma.auditEvent.findFirst({
      where: { factoryId: factory.id, action: "sales.customer_updated" },
    });
    assert.ok(logged, "changing who a bill is made out to is audited");
    assert.equal((logged.payload as { before: { gstin: null } }).before.gstin, null);
  });

  it("tells an unmentioned field from one being cleared, and still refuses nonsense", async () => {
    const { asOwner } = await staffFactory("custedit2");
    const buyer = await sales.createCustomer(asOwner, "Sharma Marbles", "9876543210", {
      gstin: "08AABCS1429B1ZX", billingAddress: "MI Road", shippingAddress: "Sitapura",
    });

    // Not mentioning a field leaves it alone.
    const renamed = await sales.updateCustomer(asOwner, buyer.id, { name: "Sharma Marbles & Co" });
    assert.equal(renamed.name, "Sharma Marbles & Co");
    assert.equal(renamed.gstin, "08AABCS1429B1ZX", "untouched");
    assert.equal(renamed.billingAddress, "MI Road", "untouched");

    // An explicit empty string clears it — a registration that lapsed is a real thing.
    const cleared = await sales.updateCustomer(asOwner, buyer.id, { gstin: "" });
    assert.equal(cleared.gstin, null);
    // The state stays. A lapsed registration does not move the buyer to another
    // state, and an unregistered buyer still needs a place of supply — dropping it
    // would quietly turn an out-of-state B2C sale into a local one.
    assert.equal(cleared.stateCode, "08");
    assert.equal(cleared.billingAddress, "MI Road", "and nothing else moved");

    await assert.rejects(
      () => sales.updateCustomer(asOwner, buyer.id, { gstin: "08AABCS1429B1Z" }),
      /must be 15 characters in the GST format/,
    );
    await assert.rejects(
      () => sales.updateCustomer(asOwner, buyer.id, { name: "   " }),
      /needs a name/,
    );
    await assert.rejects(
      () =>
        sales.updateCustomer(asOwner, buyer.id, { gstin: "08AABCS1429B1ZX", stateCode: "37" }),
      /contradicts GSTIN/,
    );
    // Another factory's buyer is not reachable.
    const other = await staffFactory("custedit3");
    await assert.rejects(
      () => sales.updateCustomer(other.asOwner, buyer.id, { name: "mine now" }),
      /Customer not found/,
    );
    // After all those refusals the row is as the last good edit left it.
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: buyer.id } });
    assert.equal(stored.name, "Sharma Marbles & Co");
    assert.equal(stored.gstin, null);
  });

  it("posts breakage to the ledger and keeps the books balanced", async () => {
    const { factory, asOwner } = await staffFactory("lotbooks");
    await receiveBlock(factory.id, "VG-001", { taxable: 180_000, cash: 0 });
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 91, damagedAtSaw: 1, sqftPerSlab: 10,
      clientOpId: "bk-cut",
    });
    await lots.writeOffBroken(asOwner, {
      blockSerial: "VG-001", slabCount: 9, stage: "loading",
      reason: "edge break while loading", clientOpId: "bk-off",
    });

    const tb = await books.trialBalance(factory.id);
    const debits = tb.reduce((sum, row) => sum + row.debit, 0);
    const credits = tb.reduce((sum, row) => sum + row.credit, 0);
    assert.equal(
      Math.round(debits * 100),
      Math.round(credits * 100),
      "a write-off must not unbalance the ledger",
    );
    const breakage = tb.find((row) => row.code === "EXP_BREAKAGE");
    assert.ok(breakage, "breakage has its own ledger head");
    // 1,80,000 over 90 good slabs is 2,000 each; nine of them is 18,000.
    assert.equal(breakage.balance, 18_000);
    // And the same value came off stock, so the yard and the balance sheet agree.
    const stock = tb.find((row) => row.code === "STOCK")!;
    assert.equal(stock.credit, 18_000);
  });

  it("records who broke what, and refuses a sales clerk the write-off", async () => {
    const { factory, asOwner } = await staffFactory("lotaudit");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 91, damagedAtSaw: 1, sqftPerSlab: 10,
      clientOpId: "au-cut",
    });
    await lots.writeOffBroken(asOwner, {
      blockSerial: "VG-001", slabCount: 2, stage: "yard", reason: "cracked in the rain",
      clientOpId: "au-off",
    });

    const event = await prisma.auditEvent.findFirst({
      where: { factoryId: factory.id, action: "lot.write_off" },
    });
    assert.ok(event, "stock cannot leave the yard untraceably");
    assert.equal(event.actorId, asOwner.id);
    const row = await prisma.stockWriteOff.findFirstOrThrow({ where: { factoryId: factory.id } });
    assert.equal(row.actorId, asOwner.id);
    assert.equal(row.reason, "cracked in the rain");
    assert.equal(row.stage, "yard");

    // Deleting stock is an inventory act, not a sales one.
    assert.equal(INVENTORY_DATA_ROLES.includes("sales"), false);
    assert.equal(INVENTORY_DATA_ROLES.includes("inventory"), true);
  });

  it("replays a resent sale instead of deducting the stock twice", async () => {
    const { factory, asOwner } = await staffFactory("lotreplay");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 91, damagedAtSaw: 1, sqftPerSlab: 10,
      clientOpId: "rp-cut",
    });
    const customer = await sales.createCustomer(asOwner, "Repeat Buyer");
    const first = await lots.sellLots(asOwner, {
      customerId: customer.id,
      lines: [{ blockSerial: "VG-001", slabCount: 40, rate: 100 }],
      clientOpId: "rp-sell",
    });
    const again = await lots.sellLots(asOwner, {
      customerId: customer.id,
      lines: [{ blockSerial: "VG-001", slabCount: 40, rate: 100 }],
      clientOpId: "rp-sell",
    });
    assert.equal(first.orderId, again.orderId, "the same send is one sale");
    const block = await prisma.rawBlock.findFirstOrThrow({
      where: { factoryId: factory.id, serialNumber: "VG-001" },
    });
    assert.equal(block.soldSlabCount, 40, "not 80");
  });

  /** An order of 80 from VG-101 and 70 from VG-102, ready to leave the gate. */
  async function orderReadyToDispatch(label: string) {
    const { factory, asOwner } = await staffFactory(label);
    for (const serial of ["VG-101", "VG-102"]) {
      await receiveBlock(factory.id, serial);
      await lots.recordCut(asOwner, {
        blockSerial: serial, totalSlabsCut: 96, damagedAtSaw: 6, sqftPerSlab: 10,
        clientOpId: `${label}-cut-${serial}`,
      });
    }
    const customer = await sales.createCustomer(asOwner, `${label} Buyer`);
    const order = await lots.sellLots(asOwner, {
      customerId: customer.id,
      lines: [
        { blockSerial: "VG-101", slabCount: 80, rate: 100 },
        { blockSerial: "VG-102", slabCount: 70, rate: 100 },
      ],
      clientOpId: `${label}-sell`,
    });
    return { factory, asOwner, order };
  }

  const orderStatus = async (id: string) =>
    (await prisma.salesOrder.findUniqueOrThrow({ where: { id } })).status;

  it("lists what is still to go, in a stable order", async () => {
    const { asOwner, order } = await orderReadyToDispatch("lotpending");
    const first = await lots.pendingDispatch(
      (await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.orderId } })).factoryId,
    );
    assert.equal(first.length, 1);
    assert.equal(first[0]!.lots.length, 2);
    // The clerk types counts into these rows, so their order must not depend on
    // however the database happened to return them.
    assert.deepEqual(first[0]!.lots.map((l) => l.blockSerial), ["VG-101", "VG-102"]);
    assert.equal(first[0]!.lots[0]!.stillToGo, 80);

    await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 80 }],
    });
    const after = await lots.pendingDispatch(first[0] ? (await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.orderId } })).factoryId : "");
    // A line sent in full drops out; the order stays while anything is owed.
    assert.deepEqual(after[0]!.lots.map((l) => l.blockSerial), ["VG-102"]);

    await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-102", slabCount: 70 }],
    });
    const done = await lots.pendingDispatch((await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.orderId } })).factoryId);
    assert.equal(done.length, 0, "a fully delivered order leaves the list");
  });

  it("sends a lot order out over several lorries, and each load actually goes", async () => {
    // The fault this guards against is the one that lost half the yard on the
    // per-slab path: a key derived from the order alone made the second lorry a
    // replay of the first, so it answered success and shipped nothing.
    const { factory, asOwner, order } = await orderReadyToDispatch("lotdisp");

    const first = await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 50 }],
    });
    assert.equal(await orderStatus(order.orderId), "PARTIALLY_DELIVERED");
    assert.deepEqual(first.sent, [{ blockSerial: "VG-101", slabCount: 50 }]);

    const second = await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 30 }, { blockSerial: "VG-102", slabCount: 70 }],
    });
    assert.notEqual(first.deliveryId, second.deliveryId, "a different load is a different delivery");
    assert.equal(await prisma.delivery.count({ where: { factoryId: factory.id } }), 2);
    assert.equal(await orderStatus(order.orderId), "DELIVERED", "the last load closes the order");
    assert.equal(second.outstanding.length, 0);

    // Every slab on the order left, not half of them.
    const sent = await prisma.deliveryLine.aggregate({
      where: { delivery: { factoryId: factory.id } },
      _sum: { slabCount: true },
    });
    assert.equal(sent._sum.slabCount, 150);
  });

  it("does not take the stock a second time when the lorry leaves", async () => {
    // The sale already deducted these slabs. If dispatch deducted them again the
    // yard count would fall twice for one load, and the shortfall would look like
    // theft rather than arithmetic.
    const { factory, asOwner, order } = await orderReadyToDispatch("lotdispstock");
    const before = await prisma.rawBlock.findFirstOrThrow({
      where: { factoryId: factory.id, serialNumber: "VG-101" },
    });
    assert.equal(before.soldSlabCount, 80);

    await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 80 }],
    });

    const after = await prisma.rawBlock.findFirstOrThrow({
      where: { factoryId: factory.id, serialNumber: "VG-101" },
    });
    assert.equal(after.soldSlabCount, 80, "dispatch is fulfilment, not a stock movement");
    assert.equal(
      after.goodSlabCount - after.brokenSlabCount - after.soldSlabCount,
      10,
      "90 cut, 80 sold, 10 still available",
    );
  });

  it("refuses to send more than the order still owes", async () => {
    const { asOwner, order } = await orderReadyToDispatch("lotdispover");
    await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 60 }],
    });
    await assert.rejects(
      () =>
        lots.dispatchLots(asOwner, {
          orderId: order.orderId,
          lines: [{ blockSerial: "VG-101", slabCount: 30 }],
        }),
      /VG-101 has 20 slabs still to go on this order/,
    );
    // And the refused attempt moved nothing.
    const line = await prisma.salesLineItem.findFirstOrThrow({
      where: { salesOrderId: order.orderId, rawBlock: { serialNumber: "VG-101" } },
    });
    assert.equal(line.dispatchedCount, 60);
  });

  it("replays a resent identical load instead of sending it twice", async () => {
    const { factory, asOwner, order } = await orderReadyToDispatch("lotdispreplay");
    const load = [{ blockSerial: "VG-101", slabCount: 40 }];
    const first = await lots.dispatchLots(asOwner, { orderId: order.orderId, lines: load });
    const again = await lots.dispatchLots(asOwner, { orderId: order.orderId, lines: load });
    assert.equal(first.deliveryId, again.deliveryId);
    assert.equal(await prisma.delivery.count({ where: { factoryId: factory.id } }), 1);
    const line = await prisma.salesLineItem.findFirstOrThrow({
      where: { salesOrderId: order.orderId, rawBlock: { serialNumber: "VG-101" } },
    });
    assert.equal(line.dispatchedCount, 40, "not 80");
  });

  it("recognises the same load described in a different order", async () => {
    const { factory, asOwner, order } = await orderReadyToDispatch("lotdisporder");
    const a = await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 10 }, { blockSerial: "VG-102", slabCount: 20 }],
    });
    const b = await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-102", slabCount: 20 }, { blockSerial: "VG-101", slabCount: 10 }],
    });
    assert.equal(a.deliveryId, b.deliveryId, "one lorry, listed two ways");
    assert.equal(await prisma.delivery.count({ where: { factoryId: factory.id } }), 1);
  });

  it("refuses a clientOpId reused for a different load", async () => {
    const { asOwner, order } = await orderReadyToDispatch("lotdispreuse");
    await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 10 }],
      clientOpId: "lot-disp-key-1",
    });
    await assert.rejects(
      () =>
        lots.dispatchLots(asOwner, {
          orderId: order.orderId,
          lines: [{ blockSerial: "VG-101", slabCount: 20 }],
          clientOpId: "lot-disp-key-1",
        }),
      /different request|CLIENT_OP_ID_REUSED/i,
    );
  });

  it("refuses a lot the order never carried, and a finished order", async () => {
    const { factory, asOwner, order } = await orderReadyToDispatch("lotdispwrong");
    await receiveBlock(factory.id, "VG-999");
    await assert.rejects(
      () =>
        lots.dispatchLots(asOwner, {
          orderId: order.orderId,
          lines: [{ blockSerial: "VG-999", slabCount: 1 }],
        }),
      /no lot line for VG-999/,
    );
    await lots.dispatchLots(asOwner, {
      orderId: order.orderId,
      lines: [{ blockSerial: "VG-101", slabCount: 80 }, { blockSerial: "VG-102", slabCount: 70 }],
    });
    assert.equal(await orderStatus(order.orderId), "DELIVERED");
    await assert.rejects(
      () =>
        lots.dispatchLots(asOwner, {
          orderId: order.orderId,
          lines: [{ blockSerial: "VG-101", slabCount: 1 }],
        }),
      /A DELIVERED order cannot be dispatched/,
    );
  });

  it("refuses a second cut on a block already sawn", async () => {
    const { factory, asOwner } = await staffFactory("lotrecut");
    await receiveBlock(factory.id, "VG-001");
    await lots.recordCut(asOwner, {
      blockSerial: "VG-001", totalSlabsCut: 91, damagedAtSaw: 1, sqftPerSlab: 10,
      clientOpId: "rc-1",
    });
    await assert.rejects(
      () =>
        lots.recordCut(asOwner, {
          blockSerial: "VG-001", totalSlabsCut: 50, damagedAtSaw: 0, sqftPerSlab: 10,
          clientOpId: "rc-2",
        }),
      /already cut: 90 slabs recorded/,
    );
  });

  it("reports a day's production, sales and money from the records", async () => {
    const { factory } = await staffFactory("dpr");
    const day = "2026-05-12";
    const { slabs, at } = await seedDay(factory.id, day);

    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "Shree Marbles", stateCode: "08" },
    });
    const order = await prisma.salesOrder.create({
      data: {
        factoryId: factory.id,
        customerId: customer.id,
        status: "CONFIRMED",
        orderDate: new Date(`${day}T00:00:00Z`),
        lines: { create: [{ slabId: slabs[0]!.id, quantitySqft: "40", rate: "150" }] },
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        factoryId: factory.id,
        salesOrderId: order.id,
        customerId: customer.id,
        invoiceNumber: "INV-2026-09001",
        amount: "7080",
        taxableAmount: "6000",
        cgstAmount: "540",
        sgstAmount: "540",
        gstRatePct: "18",
        idempotencyKey: `dpr-inv-${day}`,
        createdAt: at(16),
      },
    });
    await prisma.payment.create({
      data: {
        factoryId: factory.id,
        invoiceId: invoice.id,
        amount: "5000",
        paidAt: new Date(`${day}T00:00:00Z`),
        method: "neft",
        idempotencyKey: `dpr-pay-${day}`,
      },
    });
    await prisma.expense.create({
      data: {
        factoryId: factory.id,
        category: "diesel",
        amount: "1800",
        toWhom: "HP Pump",
        expenseDate: new Date(`${day}T00:00:00Z`),
      },
    });
    await prisma.cashSale.create({
      data: {
        factoryId: factory.id,
        salesOrderId: order.id,
        buyerName: "Counter",
        amount: "2500",
        saleDate: new Date(`${day}T00:00:00Z`),
        clientOpId: `dpr-cash-${day}`,
        recordedBy: "test",
      },
    });
    await prisma.delivery.create({
      data: {
        factoryId: factory.id,
        salesOrderId: order.id,
        dispatchedAt: at(18),
        lines: { create: [{ slabId: slabs[0]!.id }] },
      },
    });

    const data = await dailyReports.gather(factory.id, new Date(`${day}T00:00:00Z`));

    assert.equal(data.cutting.machinesRunning, 1);
    assert.equal(data.cutting.runtimeHours, 9.5);
    assert.equal(data.cutting.downtimeMinutes, 30);
    assert.equal(data.cutting.powerKwh, 412.75);
    assert.equal(data.cutting.slabsProducedPerLog, 50, "what the shop wrote down");
    assert.equal(data.cutting.slabsAddedToStock, 3, "what actually reached stock");
    assert.equal(data.cutting.sqftAddedToStock, 120, "three 8x5 slabs");
    assert.equal(data.cutting.slabsMissingDimensions, 0);
    assert.equal(data.cutting.blocksCompleted, 1);
    assert.equal(data.cutting.damagedSlabs, 2);

    assert.equal(data.ordersTaken, 1);
    assert.equal(data.orderSqft, 40);
    assert.equal(data.orderValue, 6000);
    assert.equal(data.invoices.length, 1);
    assert.equal(data.invoices[0]!.customer, "Shree Marbles");
    assert.equal(data.invoices[0]!.total, 7080);
    assert.equal(data.cashSales[0]!.amount, 2500);
    assert.equal(data.collections[0]!.amount, 5000);
    assert.equal(data.collections[0]!.invoiceNumber, "INV-2026-09001");
    assert.equal(data.expenses[0]!.category, "diesel");
    assert.equal(data.expenses[0]!.paidTo, "HP Pump");
    assert.equal(data.dispatches[0]!.slabs, 1);
  });

  it("counts a slab once however many polishing passes it took", async () => {
    const { factory } = await staffFactory("dprpolish");
    const day = "2026-09-09";
    const { slabs } = await seedDay(factory.id, day);
    const lpm = await prisma.machine.findFirstOrThrow({
      where: { factoryId: factory.id, machineType: "POLISHING" },
    });
    // The same two slabs go through grinding, then resin, then polishing — three
    // sessions, one day, two slabs finished.
    for (const processType of ["GRINDING", "RESIN", "POLISHING"] as const) {
      await prisma.polishingSession.create({
        data: {
          factoryId: factory.id,
          machineId: lpm.id,
          operationalDate: new Date(`${day}T00:00:00Z`),
          processType,
          status: "COMPLETED",
          slabs: { create: [{ slabId: slabs[0]!.id }, { slabId: slabs[1]!.id }] },
        },
      });
    }

    const data = await dailyReports.gather(factory.id, new Date(`${day}T00:00:00Z`));
    assert.equal(data.polishing.sessions, 3, "three passes were run");
    assert.equal(data.polishing.slabsPolished, 2, "over two slabs, not six");
    assert.equal(data.polishing.sqftPolished, 80, "two 8x5 slabs, counted once each");
  });

  it("counts machines running, not the day-logs they filed", async () => {
    const { factory } = await staffFactory("dprmachines");
    const day = "2026-09-16";
    await seedDay(factory.id, day);
    const machine = await prisma.machine.findFirstOrThrow({
      where: { factoryId: factory.id, machineType: "CUTTING" },
    });
    // A second block cut on the same machine the same day: one more session and
    // day-log, but still one machine on the floor.
    const second = await prisma.rawBlock.create({
      data: { factoryId: factory.id, serialNumber: `DPR2-${day}`, varietyName: "Black", weightTons: "18" },
    });
    await prisma.cuttingSession.create({
      data: {
        factoryId: factory.id,
        rawBlockId: second.id,
        machineId: machine.id,
        startedAt: new Date(`${day}T04:00:00Z`),
        status: "IN_PROGRESS",
        dayLogs: {
          create: { operationalDate: new Date(`${day}T00:00:00Z`), runtimeHours: "4", slabsProducedCount: 20 },
        },
      },
    });

    const data = await dailyReports.gather(factory.id, new Date(`${day}T00:00:00Z`));
    assert.equal(data.cutting.machinesRunning, 1, "two sessions, one machine");
    assert.equal(data.cutting.runtimeHours, 13.5, "but both sessions' hours still count");
    assert.equal(data.cutting.slabsProducedPerLog, 70);
  });

  it("counts the night shift on the day it was worked, not the calendar day", async () => {
    const { factory } = await staffFactory("dprnight");
    const day = "2026-05-20";
    await seedDay(factory.id, day);

    // The 02:00 slab was cut after midnight, so the calendar has it on the 21st.
    const worked = await dailyReports.gather(factory.id, new Date(`${day}T00:00:00Z`));
    const nextDay = await dailyReports.gather(factory.id, new Date("2026-05-21T00:00:00Z"));

    assert.equal(worked.cutting.slabsAddedToStock, 3, "all three belong to the 20th's shift");
    assert.equal(nextDay.cutting.slabsAddedToStock, 0, "and none of them to the 21st");
  });

  it("shows stock as it stood on the day, not as it stands now", async () => {
    const { factory } = await staffFactory("dprstock");
    const day = "2026-06-03";
    const { slabs, at } = await seedDay(factory.id, day);
    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "Later Buyer", stateCode: "08" },
    });
    const order = await prisma.salesOrder.create({
      data: {
        factoryId: factory.id,
        customerId: customer.id,
        status: "CONFIRMED",
        orderDate: new Date(`${day}T00:00:00Z`),
      },
    });
    // Everything leaves the yard a week later.
    await prisma.delivery.create({
      data: {
        factoryId: factory.id,
        salesOrderId: order.id,
        dispatchedAt: new Date(at(12).getTime() + 7 * 86_400_000),
        lines: { create: slabs.map((slab) => ({ slabId: slab.id })) },
      },
    });

    const onTheDay = await dailyReports.gather(factory.id, new Date(`${day}T00:00:00Z`));
    const afterwards = await dailyReports.gather(factory.id, new Date("2026-06-11T00:00:00Z"));

    assert.equal(onTheDay.closingStock.slabsOnHand, 3, "nothing had shipped yet on the 3rd");
    assert.equal(afterwards.closingStock.slabsOnHand, 0, "by the 11th it all had");
    assert.equal(onTheDay.closingStock.blocksOnHand, 0, "the block was cut that same day");
  });

  it("puts a returned slab back on the yard", async () => {
    const { factory } = await staffFactory("dprreturn");
    const day = "2026-07-08";
    const { slabs, at } = await seedDay(factory.id, day);
    const customer = await prisma.customer.create({
      data: { factoryId: factory.id, name: "Fussy Buyer", stateCode: "08" },
    });
    const order = await prisma.salesOrder.create({
      data: {
        factoryId: factory.id,
        customerId: customer.id,
        status: "CONFIRMED",
        orderDate: new Date(`${day}T00:00:00Z`),
      },
    });
    await prisma.delivery.create({
      data: {
        factoryId: factory.id,
        salesOrderId: order.id,
        dispatchedAt: at(18),
        lines: { create: [{ slabId: slabs[0]!.id }, { slabId: slabs[1]!.id }] },
      },
    });
    const afterDispatch = await dailyReports.gather(factory.id, new Date(`${day}T00:00:00Z`));
    assert.equal(afterDispatch.closingStock.slabsOnHand, 1);

    await prisma.customerReturn.create({
      data: {
        factoryId: factory.id,
        salesOrderId: order.id,
        reason: "edge chipped",
        createdAt: new Date(at(12).getTime() + 2 * 86_400_000),
        lines: { create: [{ slabId: slabs[0]!.id }] },
      },
    });
    const afterReturn = await dailyReports.gather(factory.id, new Date("2026-07-11T00:00:00Z"));
    assert.equal(afterReturn.closingStock.slabsOnHand, 2, "the rejected slab is back in stock");
  });

  it("builds a workbook a spreadsheet can actually open", async () => {
    const { factory } = await staffFactory("dprfile");
    const day = "2026-08-14";
    await seedDay(factory.id, day);

    const daily = await dailyReports.dailyWorkbook(factory.id, day);
    assert.equal(daily.fileName, "daily-progress-2026-08-14.xlsx");
    assert.equal(daily.bytes.subarray(0, 2).toString("latin1"), "PK", "a zip container");
    assert.ok(daily.bytes.length > 1000);

    const monthly = await dailyReports.monthlyWorkbook(factory.id, "2026-08");
    assert.equal(monthly.fileName, "daily-progress-2026-08.xlsx");
    assert.ok(monthly.bytes.length > daily.bytes.length, "a month holds more than a day");
  });

  it("refuses a date it cannot parse rather than reporting on the wrong day", async () => {
    const { factory } = await staffFactory("dprbad");
    for (const bad of ["2026-02-31", "yesterday", "14-08-2026"]) {
      await assert.rejects(() => dailyReports.dailyWorkbook(factory.id, bad), /date must be|not a real date/i);
    }
    await assert.rejects(() => dailyReports.monthlyWorkbook(factory.id, "2026-13"), /month must be|not a real/i);
  });

  it("leaves tomorrow out of the running month workbook", async () => {
    const { factory } = await staffFactory("dprfuture");
    const month = currentFactoryMonth();
    const workbook = await dailyReports.monthlyWorkbook(factory.id, month);
    // A month workbook pulled today must not carry tabs for days that have not
    // happened; the office opens this file every morning.
    const today = Number(currentFactoryDate().slice(8, 10));
    const figures = await dailyReports.dailyFigures(factory.id);
    assert.equal(figures.date.getUTCDate(), today);
    assert.ok(workbook.bytes.length > 0);
  });

  it("uses invoice dates across fiscal numbering, books, GSTR and customer statements", async()=>{
    const {factory,asOwner}=await staffFactory("invoice-date");
    const customer=await sales.createCustomer(asOwner,"Dated Buyer");
    const order=await sales.createOrder(asOwner,{customerId:customer.id,orderDate:currentFactoryDate(),clientOpId:"dated-order",lines:[{quantitySqft:10,rate:100}]}) as {id:string};
    const invoice=await sales.invoice(asOwner,order.id,"dated-invoice",[],undefined,"2025-03-31");
    assert.equal(invoice.invoiceDate?.toISOString().slice(0,10),"2025-03-31");
    assert.ok(invoice.invoiceNumber.startsWith("INV-2024-"));
    const voucher=await prisma.voucher.findFirstOrThrow({where:{factoryId:factory.id,source:"sales_invoice"}});
    assert.equal(voucher.operationalDate.toISOString().slice(0,10),"2025-03-31");
    const gstr=await gst.gstr1(factory.id,"2025-03");
    assert.ok(gstr.csv.includes(invoice.invoiceNumber));
    await sales.pay(asOwner,invoice.id,{amount:250,paidAt:"2025-04-01",method:"UPI",clientOpId:"dated-pay"});
    const service=new PartyReportService(prisma as never);
    const r=await service.report(factory.id,{from:"2025-04-01",to:"2025-04-30",side:"customer"});
    assert.equal(r.summary[0]?.opening,1000);assert.equal(r.summary[0]?.due,750);
    assert.equal(r.rows[0]?.mode,"UPI");assert.equal(r.rows.length,1);
    const book=await service.workbook(factory.id,{});assert.equal(book.bytes.readUInt32LE(0),0x04034b50);
    const other=await staffFactory("other-date");assert.equal((await service.report(other.factory.id)).rows.length,0);
    await assert.rejects(()=>service.report(other.factory.id,{partyId:"customer:"+customer.id}),/belong/);
    await assert.rejects(()=>sales.invoice(asOwner,order.id,"future-date",[],undefined,"2099-01-01"),/invoiceDate/);
    await assert.rejects(()=>sales.invoice(asOwner,order.id,"invalid-date",[],undefined,"2026-02-31"),/invoiceDate/);
  });
  it("reports purchase cost, supplier payments and unknown historical payment modes without duplicate vouchers",async()=>{
    const {factory,asOwner}=await staffFactory("purchase-report");const supplier=await inventory.createSupplier(asOwner,"Quarry report");
    await inventory.receiveBlock(asOwner,{serialNumber:"PR-01",varietyName:"Grey",weightTons:10,supplierId:supplier.id,invoicedAmount:1000,actualAmountPaid:250,purchaseCashAmount:100,purchasePaymentMethod:"bank transfer",clientOpId:"purchase-r1"});
    const r=await new PartyReportService(prisma as never).report(factory.id,{side:"supplier"});
    assert.equal(r.summary[0]?.due,750);assert.equal(r.totals.paid,350);assert.equal(r.rows.filter(e=>e.type==="Purchase").length,1);
    assert.ok(r.rows.some(e=>e.mode==="bank transfer"));
  });
  it("keeps complete supplier details, validates GST and isolates edits by factory",async()=>{
    const {factory,asOwner}=await staffFactory("supplier-details");
    const supplier=await inventory.createSupplier(asOwner,"  Quarry  "," 9876543210 ",{gstin:"08zzzzz0000z1zx",stateCode:"08",billingAddress:" Jaipur ",shippingAddress:" Quarry gate "});
    assert.equal(supplier.name,"Quarry");assert.equal(supplier.gstin,"08ZZZZZ0000Z1ZX");assert.equal(supplier.billingAddress,"Jaipur");
    const updated=await inventory.updateSupplier(asOwner,supplier.id,{contactInfo:"1234567890",shippingAddress:"",billingAddress:"New address"});
    assert.equal(updated.shippingAddress,null);assert.equal(updated.billingAddress,"New address");assert.equal(updated.gstin,supplier.gstin);
    assert.equal((await inventory.suppliers(factory.id))[0]?.contactInfo,"1234567890");
    const other=await staffFactory("other-supplier");
    await assert.rejects(()=>inventory.updateSupplier(other.asOwner,supplier.id,{name:"Foreign"}),/Supplier not found/);
    await assert.rejects(()=>inventory.createSupplier(asOwner,"Bad",undefined,{gstin:"123"}),/GSTIN/);
    await assert.rejects(()=>inventory.createSupplier(asOwner,"Bad",undefined,{gstin:"08ZZZZZ0000Z1ZX",stateCode:"27"}),/contradicts/);
    await assert.rejects(()=>inventory.updateSupplier(asOwner,supplier.id,{name:" "}),/needs a name/);
  });
});
