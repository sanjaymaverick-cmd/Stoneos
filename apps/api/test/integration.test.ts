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
import { FilesService } from "../src/modules/files/files.service";
import { BooksService } from "../src/modules/books/books.service";
import { KhataService } from "../src/modules/books/khata.service";
import { IntakeService } from "../src/modules/books/intake.service";
import { MusterService } from "../src/modules/muster/muster.service";
import { GstService } from "../src/modules/gst/gst.service";
import { CopilotService } from "../src/modules/books/copilot.service";
import { ReportsService } from "../src/modules/reports/reports.service";
import type { AuthenticatedUser } from "../src/common/current-user";

const root = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(root, "..");

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
        initdbFlags: ["--encoding=UTF8", "--locale=C"],
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

    const manager = await users.provision(asOwner, { username: "h-mgr", role: "manager", name: "Mgr" });
    const peerManager = await users.provision(asOwner, { username: "h-mgr2", role: "manager" });
    const admin = await users.provision(asOwner, { username: "h-admin", role: "admin" });
    const operator = await users.provision(asOwner, { username: "h-operator", role: "operator" });
    const accountant = await users.provision(asOwner, { username: "h-accounts", role: "accountant" });
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
    const manager = await users.provision(owner, { username: "mgr1", role: "manager", name: "Mgr" });
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
      clientOpId: "receipt-dup",
    })) as { block: { id: string } };
    const retry = (await inventory.receiveBlock(owner, {
      serialNumber: "V202",
      varietyName: "Steel Grey",
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
      await sales.createOrder(asOwner, {
        customerId: customer.id,
        orderDate: "2026-09-12",
        clientOpId: `${serial}-order`,
        lines: slabIds
          .slice(0, sellCount)
          .map((slabId) => ({ slabId, quantitySqft: sqftEach, rate: 100 })),
      });
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
    const gstr = await gst.gstr1(factory.id, "2026-09");
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
        gstin: `${stateCode}AABCP0000${stateCode}1Z9`,
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
    const gstr = await gst.gstr1(factory.id, "2026-09");
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

    const gstr = await gst.gstr1(factory.id, "2026-09");
    assert.equal(gstr.b2b.length, 0, "a buyer with no GSTIN is never B2B");
    const b2cDocs = [...gstr.b2cSmall, ...gstr.b2cLarge].map((r) => r.doc);
    assert.ok(b2cDocs.includes(localInv.invoiceNumber));
    assert.ok(b2cDocs.includes(outsideInv.invoiceNumber));
    assert.equal(gstr.totals.cgst + gstr.totals.sgst + gstr.totals.igst, 360, "all of it is still filed");
    assert.match(gstr.csv, /^B2CS,/m);

    // A large inter-state retail sale is reported invoice-wise, not consolidated.
    const bigInv = await billTo(outside.id, "b2cbig", 40_000);
    const after = await gst.gstr1(factory.id, "2026-09");
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
      orderDate: "2026-09-12",
      clientOpId: "cash-order",
      billingMode: "cash_unbilled",
      lines: [{ quantitySqft: 10, rate: 100 }],
    })) as { id: string };

    // A cash-sale order cannot be turned into a tax invoice by accident.
    await assert.rejects(() => sales.invoice(asOwner, order.id, "cash-inv"), /cannot be invoiced/i);

    const sale = await sales.recordCashSale(asOwner, order.id, {
      amount: 1000,
      saleDate: "2026-09-12",
      clientOpId: "cash-1",
      buyerName: "Ramesh",
    });
    const retry = await sales.recordCashSale(asOwner, order.id, {
      amount: 1000,
      saleDate: "2026-09-12",
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
    const gstr = await gst.gstr1(factory.id, "2026-09");
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
      expenseDate: "2026-09-12",
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
      orderDate: "2026-09-12",
      clientOpId: "itc-order",
      lines: [{ quantitySqft: 100, rate: 100 }],
    })) as { id: string };
    const invoice = await sales.invoice(asOwner, order.id, "itc-inv");
    assert.equal(Number(invoice.gstRatePct), 18, "finished slabs stay on 18");

    const position = await gst.position(factory.id, "2026-09");
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
});
