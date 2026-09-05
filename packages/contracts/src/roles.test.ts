import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCOUNTANT_ROLE,
  ADMIN_ROLE,
  AUDITOR_ROLE,
  MANAGER_ROLE,
  OWNER_ROLE,
  PAYMENT_ROLES,
  SALES_ROLE,
  STAFF_PROVISIONABLE_ROLES,
  canAccess,
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

  it("lets sales and accountants record invoice payments, not auditors", () => {
    assert.equal(canAccess(SALES_ROLE, PAYMENT_ROLES), true);
    assert.equal(canAccess(ACCOUNTANT_ROLE, PAYMENT_ROLES), true);
    assert.equal(canAccess(AUDITOR_ROLE, PAYMENT_ROLES), false);
  });
});
