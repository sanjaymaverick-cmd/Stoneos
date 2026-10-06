import assert from "node:assert/strict";
import { it } from "node:test";
import { ExpensesService } from "./expenses.service";
it("pages expense records and keeps search/count inside the authenticated factory", async () => {
  const calls: any[] = [];
  const prisma = {
    rawBlock: {
      findMany: async (q: any) => {
        calls.push(q);
        return [{ id: "block" }];
      },
    },
    expense: {
      findMany: async (q: any) => {
        calls.push(q);
        return [{ id: "expense" }];
      },
      count: async (q: any) => {
        calls.push(q);
        return 125;
      },
    },
  };
  const service = new ExpensesService(prisma as any, {} as any);
  const result = (await service.list("test-factory", {
    page: "2",
    pageSize: "50",
    search: "B21",
  })) as any;
  assert.equal(result.total, 125);
  assert.equal(result.items.length, 1);
  assert.equal(calls[1].skip, 50);
  assert.equal(calls[1].take, 50);
  for (const call of calls) assert.equal(call.where.factoryId, "test-factory");
  assert.deepEqual(calls[1].where, calls[2].where);
  assert.deepEqual(calls[1].where.OR[3], {
    allocations: { some: { rawBlockId: { in: ["block"] } } },
  });
  await assert.rejects(
    () => service.list("test-factory", { page: "0" }),
    /positive page/,
  );
  await assert.rejects(
    () => service.list("test-factory", { page: "1", pageSize: "10001" }),
    /pageSize/,
  );
  const legacy = await service.list("test-factory");
  assert.ok(Array.isArray(legacy));
});
