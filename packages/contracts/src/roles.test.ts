import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_ROLE,
  MANAGER_ROLE,
  OWNER_ROLE,
  STAFF_PROVISIONABLE_ROLES,
  canGrantOwner,
  canManageUsers,
} from "./roles.ts";

describe("role policy", () => {
  it("lets owners and managers manage staff", () => {
    assert.equal(canManageUsers(OWNER_ROLE), true);
    assert.equal(canManageUsers(MANAGER_ROLE), true);
    assert.equal(canManageUsers(ADMIN_ROLE), false);
  });

  it("lets only owners grant ownership", () => {
    assert.equal(canGrantOwner(OWNER_ROLE), true);
    assert.equal(canGrantOwner(MANAGER_ROLE), false);
    assert.equal(canGrantOwner(ADMIN_ROLE), false);
  });

  it("does not let staff provisioning include owner", () => {
    assert.equal(STAFF_PROVISIONABLE_ROLES.includes(OWNER_ROLE), false);
  });
});
