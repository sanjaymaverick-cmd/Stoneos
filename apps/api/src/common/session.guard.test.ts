import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { SessionGuard } from "./session.guard";

test("a request without a token is rejected", async () => {
  const guard = new SessionGuard(
    {} as never,
    { getAllAndOverride: () => false } as never,
  );
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
    }),
  };
  await assert.rejects(() => guard.canActivate(context as never), UnauthorizedException);
});

test("a public route does not need a token", async () => {
  const guard = new SessionGuard(
    {} as never,
    { getAllAndOverride: () => true } as never,
  );
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
    }),
  };
  assert.equal(await guard.canActivate(context as never), true);
});
