import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canGrantOwner, canManageUsers, STAFF_PROVISIONABLE_ROLES } from "@stoneos/contracts";

describe("authorization matrix", () => {
  it("keeps people-admin on owner and manager only", () => {
    assert.equal(canManageUsers("owner"), true);
    assert.equal(canManageUsers("manager"), true);
    assert.equal(canManageUsers("admin"), false);
    assert.equal(canManageUsers("supervisor"), false);
  });

  it("prevents managers and admins from granting ownership", () => {
    assert.equal(canGrantOwner("owner"), true);
    assert.equal(canGrantOwner("manager"), false);
    assert.equal(canGrantOwner("admin"), false);
    assert.equal(STAFF_PROVISIONABLE_ROLES.includes("owner"), false);
  });
});
