import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InventoryService } from "../modules/inventory/inventory.service";
import { queryText, registerPage } from "./registers";

describe("register query parsing", () => {
  it("takes the first value of a repeated key instead of passing an array to Prisma", () => {
    assert.equal(queryText({ q: ["B21", "B22"] }, "q"), "B21");
    assert.equal(queryText({ q: "  B21  " }, "q"), "B21");
    assert.equal(queryText({ q: "   " }, "q"), undefined);
    assert.equal(queryText({}, "q"), undefined);
    assert.equal(queryText({ q: { nested: "x" } }, "q"), undefined);
    assert.equal(queryText({ q: "x".repeat(500) }, "q")?.length, 120);
  });

  it("pages only when asked, within bounds", () => {
    assert.equal(registerPage({}), undefined);
    assert.deepEqual(registerPage({ page: "3", pageSize: "20" }), { page: 3, pageSize: 20, skip: 40, take: 20 });
    assert.deepEqual(registerPage({ page: ["2", "9"] }), { page: 2, pageSize: 50, skip: 50, take: 50 });
    for (const query of [{ page: "0" }, { page: "1.5" }, { page: "x" }, { page: "1", pageSize: "101" }]) {
      assert.throws(() => registerPage(query), /positive page/);
    }
  });

  it("serves a repeated search key as a normal search, not a 500", async () => {
    const calls: Array<{ where: { OR?: Array<Record<string, { contains: unknown }>> } }> = [];
    const model = {
      findMany: async (query: (typeof calls)[number]) => {
        calls.push(query);
        return [];
      },
      count: async () => 0,
    };
    const service = new InventoryService({ rawBlock: model, slab: model } as never, {} as never, {} as never);
    await service.rawBlocks("factory-a", { page: "1", q: ["VG", "XX"], status: ["in_stock", "sold"] });
    const where = calls[0]!.where as { OR: Array<{ serialNumber?: { contains: unknown } }>; currentStatus?: unknown };
    assert.equal(where.OR[0]!.serialNumber!.contains, "VG");
    assert.equal(where.currentStatus, "in_stock");
  });
});
