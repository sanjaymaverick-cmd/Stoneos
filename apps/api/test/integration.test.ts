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
import { SalesService } from "../src/modules/sales/sales.service";
import { ExpensesService } from "../src/modules/expenses/expenses.service";
import { AuditService } from "../src/common/audit.service";
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
  let factoryId = "";
  let owner: AuthenticatedUser;

  before(async () => {
    if (!process.env.DATABASE_URL) {
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
    }
    execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
      cwd: apiRoot,
      env: { ...process.env },
      stdio: "inherit",
    });
    prisma = new PrismaClient();
    const audit = new AuditService(prisma as never);
    auth = new AuthService(prisma as never, audit);
    users = new UsersService(prisma as never, audit);
    inventory = new InventoryService(prisma as never, audit);
    production = new ProductionService(prisma as never, audit);
    sales = new SalesService(prisma as never, audit);
    expenses = new ExpensesService(prisma as never);

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

  it("rejects a manager creating an owner", async () => {
    const manager = await users.provision(owner, { username: "mgr1", role: "manager", name: "Mgr" });
    const asManager: AuthenticatedUser = {
      ...owner,
      id: manager.user.id,
      role: "manager",
      username: "mgr1",
    };
    await assert.rejects(() => users.provision(asManager, { username: "otherowner", role: "owner" }));
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
    const manager = await prisma.appUser.findFirst({ where: { factoryId, username: "mgr1" } });
    const asManager: AuthenticatedUser = {
      ...owner,
      id: manager!.id,
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
    const slab = await prisma.slab.findFirst({ where: { factoryId } });
    const order = (await sales.createOrder(owner, {
      customerId: customer.id,
      orderDate: "2026-09-05",
      clientOpId: "order-1",
      lines: [{ slabId: slab?.id, quantitySqft: 32, rate: 100 }],
    })) as { id: string };
    const first = await sales.invoice(owner, order.id, "inv-1");
    const retry = await sales.invoice(owner, order.id, "inv-1");
    assert.equal(first.id, (retry as { id: string }).id);
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
});
