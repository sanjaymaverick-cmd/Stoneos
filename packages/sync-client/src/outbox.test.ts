import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actorMatches,
  bindOutboxItem,
  flushOutbox,
  MAX_OUTBOX_ATTEMPTS,
  MemoryOutboxStore,
  replayBody,
  summariseOutbox,
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

  it("survives an expired session instead of deleting the work", async () => {
    // This was the data loss: any 4xx marked the item dead, and the shell flushes
    // every few seconds, so a supervisor whose token lapsed mid-shift lost every
    // queued write before they could log back in — silently.
    const store = new MemoryOutboxStore();
    await store.put(item("offline-write"));

    // Twenty flushes while logged out. MAX_OUTBOX_ATTEMPTS is 8, so a version that
    // spent an attempt per 401 would have buried this long ago.
    for (let i = 0; i < 20; i += 1) {
      const result = await flushOutbox(
        store,
        async () => ({ ok: false, status: 401, body: { message: "Unauthorized" } }),
        { userId: "u1", factoryId: "f1" },
      );
      assert.equal(result.blocked, 1, `flush ${i} must be blocked, not failed`);
      assert.equal(result.failed, 0);
    }
    const held = (await store.list())[0];
    assert.equal(held?.dead, undefined, "an expired session must never kill a write");
    assert.equal(held?.attempts, 0, "a 401 must not spend a retry attempt");
    assert.equal(held?.heldForAuth, true);

    // Signing back in delivers it.
    const after = await flushOutbox(
      store,
      async () => ({ ok: true, status: 200, body: {} }),
      { userId: "u1", factoryId: "f1" },
    );
    assert.equal(after.flushed, 1);
    assert.equal((await store.list()).length, 0);
  });

  it("retries a 403 but lets it die at the cap", async () => {
    // A forced password change and a genuine denial both return 403, so it cannot be
    // treated as permanent on sight — but it must not be retried forever either.
    const store = new MemoryOutboxStore();
    await store.put(item("maybe-forbidden"));
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS; i += 1) {
      await flushOutbox(store, async () => ({ ok: false, status: 403, body: {} }), {
        userId: "u1",
        factoryId: "f1",
      });
    }
    assert.equal((await store.list())[0]?.dead, undefined, "still alive at the cap boundary");
    await flushOutbox(store, async () => ({ ok: false, status: 403, body: {} }), {
      userId: "u1",
      factoryId: "f1",
    });
    assert.equal((await store.list())[0]?.dead, true, "and dead once the cap is spent");
  });

  it("retries a 429 and a 408 rather than discarding them", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("throttled"));
    await store.put(item("timeout"));
    await flushOutbox(
      store,
      async (queued) => ({
        ok: false,
        status: queued.clientOpId === "throttled" ? 429 : 408,
        body: {},
      }),
      { userId: "u1", factoryId: "f1" },
    );
    for (const row of await store.list()) {
      assert.equal(row.dead, undefined, `${row.clientOpId} must stay queued`);
    }
  });

  it("summarises the queue so stuck work cannot read as synced", async () => {
    const store = new MemoryOutboxStore();
    await store.put(item("a"));
    await store.put(item("held", { heldForAuth: true }));
    await store.put(item("clash", { conflict: { code: "VERSION_CONFLICT" } }));
    await store.put(item("gone", { dead: true }));
    const summary = summariseOutbox(await store.list());
    assert.deepEqual(summary, {
      pending: 1,
      blocked: 1,
      conflicts: 1,
      dead: 1,
      needsAttention: 2,
    });
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
