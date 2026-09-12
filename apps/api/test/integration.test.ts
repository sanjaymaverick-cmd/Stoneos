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
    inventory = new InventoryService(prisma as never, audit);
    production = new ProductionService(prisma as never, audit);
    books = new BooksService(prisma as never);
    sales = new SalesService(prisma as never, audit, books);
    expenses = new ExpensesService(prisma as never, books);
    const files = new FilesService(prisma as never, audit);
    khata = new KhataService(prisma as never, files);
    intake = new IntakeService(prisma as never, files, expenses, sales, production);

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
    assert.ok(salesV?.lines.some((l) => l.ledger.code === "GST_OUTPUT" && l.credit > 0));
    const ar = salesV!.lines.find((l) => l.ledger.code === "AR");
    assert.equal(ar?.debit, 320000);
    const outstanding = await books.outstanding(factory.id);
    assert.equal(outstanding.youllGet, 2200);
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
});
