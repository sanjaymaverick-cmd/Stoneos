import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { IdempotencyInterceptor, type IdempotencyService } from "./idempotency";

function fakeStore() {
  const rows = new Map<string, { statusCode: number; response: unknown }>();
  return {
    rows,
    async lookup(_user: unknown, clientOpId: string) {
      return rows.get(clientOpId) ?? null;
    },
    async remember(_user: unknown, clientOpId: string, _m: string, _p: string, statusCode: number, response: unknown) {
      if (!rows.has(clientOpId)) rows.set(clientOpId, { statusCode, response });
    },
  };
}

function context(req: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
  const ctx = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

const user = { id: "u1", factoryId: "f1" };

describe("IdempotencyInterceptor", () => {
  it("runs a keyed write once and replays its answer after that", async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store as unknown as IdempotencyService);
    let runs = 0;
    const handler: CallHandler = { handle: () => of({ slabs: ++runs }) };
    const req = { method: "POST", originalUrl: "/api/v1/cutting-sessions/s/complete", user, body: { clientOpId: "op-12345678" } };

    const first = context(req);
    assert.deepEqual(await firstValueFrom(interceptor.intercept(first.ctx, handler)), { slabs: 1 });
    const again = context(req);
    assert.deepEqual(await firstValueFrom(interceptor.intercept(again.ctx, handler)), { slabs: 1 });
    assert.equal(runs, 1);
    assert.equal(again.headers["Idempotent-Replay"], "true");
  });

  it("leaves unkeyed writes, reads and logins alone", async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store as unknown as IdempotencyService);
    let runs = 0;
    const handler: CallHandler = { handle: () => of(++runs) };
    for (const req of [
      { method: "POST", originalUrl: "/api/v1/consumables", user, body: { name: "x" } },
      { method: "GET", originalUrl: "/api/v1/machines", user, body: { clientOpId: "op-12345678" } },
      { method: "POST", originalUrl: "/api/v1/auth/login", body: { clientOpId: "op-12345678" } },
      { method: "POST", originalUrl: "/api/v1/expenses", user, body: { clientOpId: "bad key with spaces" } },
    ]) {
      await firstValueFrom(interceptor.intercept(context(req).ctx, handler));
      await firstValueFrom(interceptor.intercept(context(req).ctx, handler));
    }
    assert.equal(runs, 8);
    assert.equal(store.rows.size, 0);
  });
});
