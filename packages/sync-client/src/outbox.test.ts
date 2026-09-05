import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flushOutbox, MemoryOutboxStore, type OutboxItem } from "./outbox.ts";

function item(id: string): OutboxItem {
  return {
    clientOpId: id,
    method: "POST",
    path: "/api/v1/inventory/movements",
    body: { quantity: 1 },
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

describe("outbox", () => {
  it("removes successful retries and keeps 409 conflicts", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("ok"));
    await store.put(item("conflict"));
    const result = await flushOutbox(store, async (queued) => {
      if (queued.clientOpId === "ok") return { ok: true, status: 200, body: {} };
      return { ok: false, status: 409, body: { code: "VERSION_CONFLICT" } };
    });
    assert.equal(result.flushed, 1);
    assert.equal(result.conflicts, 1);
    const remaining = await store.list();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.clientOpId, "conflict");
    assert.ok(remaining[0]?.conflict);
  });
});
