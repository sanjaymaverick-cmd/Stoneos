import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbOutboxStore } from "./indexeddb.ts";
import {
  bindOutboxItem,
  flushOutbox,
  MemoryOutboxStore,
  retryOutboxItem,
  type OutboxItem,
} from "./outbox.ts";
import { collectRefs, pendingRef, pick, ref, resolveRefs, UnresolvedRefError } from "./refs.ts";

const actor = { userId: "u1", factoryId: "f1" };

function queue(path: string, body: Record<string, unknown>, clientOpId: string, label?: string): OutboxItem {
  const item = bindOutboxItem({ method: "POST", path, body: { ...body, clientOpId }, actor, label });
  // Distinct, ordered timestamps so the flush order is the order they were made.
  return { ...item, createdAt: new Date(Date.UTC(2026, 0, 1) + Number(clientOpId.replace(/\D/g, "") || 0)).toISOString() };
}

describe("refs", () => {
  it("picks nested ids and maps over arrays", () => {
    const body = { block: { id: "b1" }, slabs: [{ id: "s1" }, { id: "s2" }] };
    assert.equal(pick(body, "block.id"), "b1");
    assert.deepEqual(pick(body, "slabs[*].id"), ["s1", "s2"]);
    assert.equal(pick(body, "slabs[1].id"), "s2");
    assert.equal(pick(body, "nope.id"), undefined);
  });

  it("fills a path segment, a whole field, and a mixed list", () => {
    const results: Record<string, unknown> = {
      "op-1": { id: "sess 9" },
      "op-2": { slabs: [{ id: "s1" }, { id: "s2" }] },
    };
    const lookup = (id: string) => results[id];
    assert.equal(resolveRefs(`/api/v1/cutting-sessions/${ref("op-1")}/complete`, lookup), "/api/v1/cutting-sessions/sess%209/complete");
    assert.deepEqual(resolveRefs({ slabIds: ref("op-2", "slabs[*].id") }, lookup), { slabIds: ["s1", "s2"] });
    assert.deepEqual(resolveRefs({ slabIds: [ref("op-2", "slabs[*].id"), "s9"] }, lookup), { slabIds: ["s1", "s2", "s9"] });
    assert.deepEqual(collectRefs(`/x/${ref("op-1")}`, { a: [ref("op-2", "slabs[*].id")] }).sort(), ["op-1", "op-2"]);
    assert.throws(() => resolveRefs({ id: ref("op-1", "missing") }, lookup), UnresolvedRefError);
  });

  it("gives a readable pending number", () => {
    assert.equal(pendingRef("7f3a9c12-0000-4000-8000-000000000000"), "PEND-7F3A9C");
  });
});

describe("dependent writes", () => {
  it("sends start → complete → polish in order with the real ids filled in", async () => {
    const store = new MemoryOutboxStore();
    await store.put(queue("/api/v1/cutting-sessions", { rawBlockId: "b1" }, "op-1"));
    await store.put(queue(`/api/v1/cutting-sessions/${ref("op-1")}/complete`, { totalSlabsCut: 2, finalGoodSlabCount: 2 }, "op-2"));
    await store.put(queue("/api/v1/polishing-sessions", { slabIds: ref("op-2", "slabs[*].id") }, "op-3"));

    const sent: Array<{ path: string; body: unknown }> = [];
    const result = await flushOutbox(
      store,
      async (item) => {
        sent.push({ path: item.path, body: item.body });
        if (item.clientOpId === "op-1") return { ok: true, status: 201, body: { id: "sess-1" } };
        if (item.clientOpId === "op-2") return { ok: true, status: 201, body: { slabs: [{ id: "s1" }, { id: "s2" }] } };
        return { ok: true, status: 201, body: { id: "pol-1" } };
      },
      actor,
    );
    assert.equal(result.flushed, 3);
    assert.equal(sent[1]!.path, "/api/v1/cutting-sessions/sess-1/complete");
    assert.deepEqual((sent[2]!.body as { slabIds: string[] }).slabIds, ["s1", "s2"]);
    assert.equal((await store.getResult("op-3"))?.body && ((await store.getResult("op-3"))!.body as { id: string }).id, "pol-1");
  });

  it("holds a child while its parent is still failing, without spending its attempts", async () => {
    const store = new MemoryOutboxStore();
    await store.put(queue("/api/v1/sales-orders", { lines: [] }, "op-1"));
    await store.put(queue(`/api/v1/sales-orders/${ref("op-1")}/invoice`, {}, "op-2"));
    const result = await flushOutbox(store, async () => ({ ok: false, status: 503, body: {} }), actor);
    assert.equal(result.failed, 1);
    assert.equal(result.waiting, 1);
    const child = (await store.list()).find((i) => i.clientOpId === "op-2")!;
    assert.equal(child.attempts, 0);
    assert.equal(child.conflict, undefined);
  });

  it("parks a child as a conflict when its parent is refused, and frees it on retry", async () => {
    const store = new MemoryOutboxStore();
    await store.put(queue("/api/v1/sales-orders", { lines: [] }, "op-1", "Order PEND-A"));
    await store.put(queue(`/api/v1/sales-orders/${ref("op-1")}/invoice`, {}, "op-2", "Invoice PEND-B"));
    const refusal = { code: "SLABS_UNAVAILABLE", droppedSlabs: [{ slabSerial: "X-1" }] };
    const first = await flushOutbox(store, async () => ({ ok: false, status: 409, body: refusal }), actor);
    assert.equal(first.conflicts, 2, "the order conflicts and the invoice inherits it in the same pass");
    const [order, invoice] = await store.list();
    assert.deepEqual(order!.conflict, refusal);
    assert.equal((invoice!.conflict as { code: string; parentLabel: string }).code, "PARENT_FAILED");
    assert.equal((invoice!.conflict as { parentLabel: string }).parentLabel, "Order PEND-A");

    // The salesman fixes the order and retries both; now they go through.
    await retryOutboxItem(store, "op-1");
    await retryOutboxItem(store, "op-2");
    const second = await flushOutbox(
      store,
      async (item) => ({ ok: true, status: 201, body: item.clientOpId === "op-1" ? { id: "o1" } : { invoiceNumber: "INV-2026-00001" } }),
      actor,
    );
    assert.equal(second.flushed, 2);
    assert.equal(((await store.getResult("op-2"))!.body as { invoiceNumber: string }).invoiceNumber, "INV-2026-00001");
  });

  it("parks a child whose parent was discarded", async () => {
    const store = new MemoryOutboxStore();
    await store.put(queue(`/api/v1/sales-orders/${ref("gone-1")}/invoice`, {}, "op-2"));
    const result = await flushOutbox(store, async () => ({ ok: true, status: 201, body: {} }), actor);
    assert.equal(result.conflicts, 1);
    assert.equal(((await store.list())[0]!.conflict as { code: string }).code, "PARENT_FAILED");
  });
});

describe("IndexedDbOutboxStore", () => {
  it("keeps items and results, and moves the old localStorage queue across once", async () => {
    const legacy = new MemoryOutboxStore();
    await legacy.put(queue("/api/v1/expenses", { amount: 1 }, "old-1"));
    const store = new IndexedDbOutboxStore(new IDBFactory(), legacy);
    assert.deepEqual((await store.list()).map((i) => i.clientOpId), ["old-1"]);
    assert.equal((await legacy.list()).length, 0, "the old copy is cleared after the move");

    await store.put(queue("/api/v1/expenses", { amount: 2 }, "new-2"));
    await store.putResult({ clientOpId: "r1", method: "POST", path: "/x", status: 201, body: { id: 1 }, syncedAt: "2020-01-01T00:00:00.000Z" });
    await store.putResult({ clientOpId: "r2", method: "POST", path: "/x", status: 201, body: { id: 2 }, syncedAt: new Date().toISOString() });
    await store.pruneResults(new Date(Date.now() - 1000 * 3600));
    assert.deepEqual((await store.listResults()).map((r) => r.clientOpId), ["r2"]);
    await store.remove("old-1");
    assert.deepEqual((await store.list()).map((i) => i.clientOpId), ["new-2"]);

    await store.putRead("u1:/api/v1/machines", [{ id: "m1" }]);
    assert.deepEqual((await store.getRead("u1:/api/v1/machines"))?.body, [{ id: "m1" }]);
    await store.clearReads();
    assert.equal(await store.getRead("u1:/api/v1/machines"), undefined);
  });
});
