import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canGrantOwner, canManageUsers } from "@stoneos/contracts";

describe("user provisioning guards", () => {
  it("treats admin as not a people-admin", () => {
    assert.equal(canManageUsers("admin"), false);
    assert.equal(canGrantOwner("admin"), false);
  });
});
