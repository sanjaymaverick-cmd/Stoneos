import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { assertAllowedRoles } from "./session.guard.ts";

describe("deny-by-default roles", () => {
  it("rejects a missing annotation", () => {
    assert.throws(() => assertAllowedRoles(undefined, "operator"), ForbiddenException);
    assert.throws(() => assertAllowedRoles([], "owner"), ForbiddenException);
  });

  it("rejects an operator on CEO routes", () => {
    assert.throws(
      () => assertAllowedRoles(["owner", "manager", "accountant", "auditor", "admin"], "operator"),
      ForbiddenException,
    );
  });

  it("allows an owner on CEO routes", () => {
    assert.doesNotThrow(() =>
      assertAllowedRoles(["owner", "manager", "accountant", "auditor", "admin"], "owner"),
    );
  });
});
