import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actorMatches,
  bindOutboxItem,
  flushOutbox,
  MAX_OUTBOX_ATTEMPTS,
  MemoryOutboxStore,
  replayBody,
  type OutboxItem,
} from "./outbox.ts";

function item(id: string, extra: Partial<OutboxItem> = {}): OutboxItem {
  return {
    clientOpId: id,
    method: "POST",
    path: "/api/v1/inventory/raw-blocks",
    body: { quantity: 1, clientOpId: id },
    createdAt: new Date().toISOString(),
    attempts: 0,
    userId: "u1",
    factoryId: "f1",
    ...extra,
  };
}

describe("outbox", () => {
  it("removes successful retries and keeps 409 conflicts", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("ok"));
    await store.put(item("conflict"));
    const result = await flushOutbox(
      store,
      async (queued) => {
        if (queued.clientOpId === "ok") return { ok: true, status: 200, body: {} };
        return { ok: false, status: 409, body: { code: "VERSION_CONFLICT" } };
      },
      { userId: "u1", factoryId: "f1" },
    );
    assert.equal(result.flushed, 1);
    assert.equal(result.conflicts, 1);
    const remaining = await store.list();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.clientOpId, "conflict");
    assert.ok(remaining[0]?.conflict);
  });

  it("binds user+factory and reuses the body's clientOpId", () => {
    const queued = bindOutboxItem({
      method: "POST",
      path: "/api/v1/invoices/1/payments",
      body: { amount: 10, clientOpId: "kept-id" },
      actor: { userId: "u1", factoryId: "f1" },
    });
    assert.equal(queued.clientOpId, "kept-id");
    assert.equal((queued.body as { clientOpId: string }).clientOpId, "kept-id");
    assert.equal(queued.userId, "u1");
    assert.equal(queued.factoryId, "f1");
    assert.equal((replayBody(queued) as { clientOpId: string }).clientOpId, "kept-id");
  });

  it("refuses replay when the actor does not match", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("other-user"));
    const result = await flushOutbox(
      store,
      async () => {
        throw new Error("must not send");
      },
      { userId: "u2", factoryId: "f1" },
    );
    assert.equal(result.skipped, 1);
    assert.equal(result.flushed, 0);
    assert.equal((await store.list()).length, 1);
    assert.equal(actorMatches(item("x"), { userId: "u2", factoryId: "f1" }), false);
  });

  it("stops retrying 400s and caps attempts", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("bad"));
    const first = await flushOutbox(
      store,
      async () => ({ ok: false, status: 400, body: { message: "no" } }),
      { userId: "u1", factoryId: "f1" },
    );
    assert.equal(first.failed, 1);
    const dead = (await store.list())[0];
    assert.equal(dead?.dead, true);

    const capped = item("cap", { attempts: MAX_OUTBOX_ATTEMPTS });
    await store.put(capped);
    let sent = 0;
    const second = await flushOutbox(
      store,
      async () => {
        sent += 1;
        return { ok: true, status: 200, body: {} };
      },
      { userId: "u1", factoryId: "f1" },
    );
    assert.equal(sent, 0);
    assert.equal(second.failed, 1);
  });

  it("keeps the item when send throws a network error", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("net"));
    const result = await flushOutbox(
      store,
      async () => {
        throw new Error("fetch failed");
      },
      { userId: "u1", factoryId: "f1" },
    );
    assert.equal(result.failed, 1);
    const remaining = (await store.list())[0];
    assert.equal(remaining?.clientOpId, "net");
    assert.equal(remaining?.attempts, 1);
    assert.equal(remaining?.dead, undefined);
  });
});
