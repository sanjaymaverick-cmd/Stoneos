import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { Role } from "@stoneos/contracts";
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

  it("refuses a manager the executive board but not the commercial routes", () => {
    // The owner dashboard and Copilot are owner + auditor only; a manager keeps
    // everything below, which is where the trial balance and AR live.
    const executive: Role[] = ["owner", "auditor"];
    const commercial: Role[] = ["owner", "manager", "accountant", "auditor", "admin"];
    assert.throws(() => assertAllowedRoles(executive, "manager"), ForbiddenException);
    assert.throws(() => assertAllowedRoles(executive, "admin"), ForbiddenException);
    assert.throws(() => assertAllowedRoles(executive, "accountant"), ForbiddenException);
    assert.doesNotThrow(() => assertAllowedRoles(executive, "owner"));
    assert.doesNotThrow(() => assertAllowedRoles(executive, "auditor"));
    assert.doesNotThrow(() => assertAllowedRoles(commercial, "manager"));
  });

  it("allows an owner on CEO routes", () => {
    assert.doesNotThrow(() =>
      assertAllowedRoles(["owner", "manager", "accountant", "auditor", "admin"], "owner"),
    );
  });
});
