import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROLES,
  canAdminister,
  canAssignRoles,
  canGrantOwner,
  canManageUsers,
} from "@stoneos/contracts";

describe("user provisioning guards", () => {
  it("treats admin as not a people-admin", () => {
    assert.equal(canManageUsers("admin"), false);
    assert.equal(canGrantOwner("admin"), false);
  });

  it("gives role assignment to the owner and nobody else", () => {
    assert.equal(canAssignRoles("owner"), true);
    for (const role of ROLES.filter((r) => r !== "owner")) {
      assert.equal(canAssignRoles(role), false, `${role} must not assign roles`);
    }
  });

  it("lets a role act downward only, never on a peer", () => {
    // The owner reaches everyone, co-owners included.
    for (const role of ROLES) assert.equal(canAdminister("owner", role), true);

    // A manager reaches below and stops there.
    assert.equal(canAdminister("manager", "admin"), true);
    assert.equal(canAdminister("manager", "supervisor"), true);
    assert.equal(canAdminister("manager", "operator"), true);
    assert.equal(canAdminister("manager", "accountant"), true);
    assert.equal(canAdminister("manager", "manager"), false);
    assert.equal(canAdminister("manager", "owner"), false);

    // Nobody below manager administers anyone at all.
    for (const actor of ROLES.filter((r) => r !== "owner" && r !== "manager")) {
      for (const target of ROLES) {
        assert.equal(canAdminister(actor, target), false, `${actor} must not administer ${target}`);
      }
    }
  });

  it("keeps peers level so no one is administered by an equal", () => {
    const specialists = ["accountant", "auditor", "sales", "inventory", "operator"] as const;
    for (const a of specialists) {
      for (const b of specialists) assert.equal(canAdminister(a, b), false);
    }
  });
});
