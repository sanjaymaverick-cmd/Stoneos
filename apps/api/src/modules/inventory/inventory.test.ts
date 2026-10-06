import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { damagedSlabCount, slabSerial } from "@stoneos/domain";
import { InventoryService } from "./inventory.service";
import { ConsumablesController } from "../production/consumables.controller";

describe("bounded inventory registers", () => {
  const fixture = () => {
    const calls: any[] = [];
    const model = {
      findMany: async (query: any) => {
        calls.push(query);
        return [{ id: "row" }];
      },
      count: async (query: any) => {
        calls.push(query);
        return 123;
      },
    };
    const prisma = {
      rawBlock: model,
      slab: model,
      consumable: model,
      consumableMovement: model,
    } as any;
    return {
      calls,
      service: new InventoryService(prisma, {} as any, {} as any),
      consumables: new ConsumablesController(prisma),
    };
  };
  it("bounds and scopes slab search and preserves legacy arrays", async () => {
    const { calls, service } = fixture();
    const page = await service.slabs("factory-a", {
      page: "2",
      pageSize: "25",
      q: "B21",
      parentBlockId: "block-a",
      salesStatus: "in_stock",
    });
    assert.deepEqual(page, {
      items: [{ id: "row" }],
      total: 123,
      page: 2,
      pageSize: 25,
    });
    assert.equal(calls[0].where.factoryId, "factory-a");
    assert.equal(calls[0].where.parentBlockId, "block-a");
    assert.equal(calls[0].where.salesStatus, "in_stock");
    assert.equal(calls[0].skip, 25);
    assert.equal(calls[0].take, 25);
    assert.deepEqual(calls[1].where, calls[0].where);
    assert.ok(Array.isArray(await service.slabs("factory-a")));
    assert.equal(calls[2].take, undefined);
  });
  it("rejects unbounded, fractional and malformed paging", async () => {
    const { service, consumables } = fixture();
    for (const query of [
      { page: "0" },
      { page: "1.5" },
      { page: "NaN" },
      { page: "1", pageSize: "101" },
    ]) {
      await assert.rejects(service.rawBlocks("factory-a", query));
      await assert.rejects(
        consumables.list({ factoryId: "factory-a" } as any, query),
      );
    }
  });
  it("preserves direct legacy material callers and the history cap", async () => {
    const { calls, consumables } = fixture();
    const user = { factoryId: "factory-a" } as any;
    assert.ok(Array.isArray(await consumables.movements(user)));
    assert.equal(calls[0].take, 200);
    assert.ok(Array.isArray(await consumables.list(user)));
    assert.equal(calls[1].take, undefined);
  });
  it("uses identical factory/search constraints for material rows and count", async () => {
    const { calls, consumables } = fixture();
    const page = await consumables.movements(
      { factoryId: "factory-a" } as any,
      { page: "3", pageSize: "20", q: "epoxy", direction: "usage" },
    );
    assert.equal((page as any).total, 123);
    assert.equal(calls[0].where.factoryId, "factory-a");
    assert.equal(calls[0].where.direction, "usage");
    assert.equal(calls[0].take, 20);
    assert.equal(calls[0].skip, 40);
    assert.deepEqual(calls[0].where, calls[1].where);
  });
});

describe("inventory rules", () => {
  it("does not invent inventory rows for damaged slabs", () => {
    const good = 47;
    const cut = 50;
    assert.equal(damagedSlabCount(cut, good), 3);
    const serials = Array.from({ length: good }, (_, i) =>
      slabSerial("V101", cut, i + 1),
    );
    assert.equal(serials.length, 47);
    assert.equal(serials[0], "V101/50/01");
  });
});
