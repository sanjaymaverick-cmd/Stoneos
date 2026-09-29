import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCOUNTANT_ROLE,
  ADMIN_ROLE,
  AUDITOR_ROLE,
  BOOKS_STATEMENT_ROLES,
  COPILOT_PROPOSE_ROLES,
  COMMERCIAL_READ_ROLES,
  EXECUTIVE_ROLES,
  HISTORICAL_IMPORT_ROLES,
  MANAGER_ROLE,
  OPERATOR_ROLE,
  OWNER_ROLE,
  PAYMENT_ROLES,
  SALES_ROLE,
  STAFF_PROVISIONABLE_ROLES,
  SUPERVISOR_ROLE,
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

  it("keeps commercial metrics off the shop floor", () => {
    assert.equal(canAccess(OWNER_ROLE, COMMERCIAL_READ_ROLES), true);
    assert.equal(canAccess(ACCOUNTANT_ROLE, COMMERCIAL_READ_ROLES), true);
    assert.equal(canAccess(OPERATOR_ROLE, COMMERCIAL_READ_ROLES), false);
    assert.equal(canAccess(SALES_ROLE, COMMERCIAL_READ_ROLES), false);
  });

  it("keeps the executive board to the owner and the auditor", () => {
    assert.equal(canAccess(OWNER_ROLE, EXECUTIVE_ROLES), true);
    assert.equal(canAccess(AUDITOR_ROLE, EXECUTIVE_ROLES), true);
    // A manager runs the plant but the executive board is the owner's.
    assert.equal(canAccess(MANAGER_ROLE, EXECUTIVE_ROLES), false);
    assert.equal(canAccess(ADMIN_ROLE, EXECUTIVE_ROLES), false);
    assert.equal(canAccess(ACCOUNTANT_ROLE, EXECUTIVE_ROLES), false);
    assert.equal(canAccess(OPERATOR_ROLE, EXECUTIVE_ROLES), false);
  });

  it("still lets a manager do the commercial work below the board", () => {
    // Losing the board must not cost a manager the ability to chase a customer,
    // read the trial balance or file a return.
    assert.equal(canAccess(MANAGER_ROLE, COMMERCIAL_READ_ROLES), true);
    assert.equal(canAccess(MANAGER_ROLE, BOOKS_STATEMENT_ROLES), true);
    assert.equal(canAccess(MANAGER_ROLE, PAYMENT_ROLES), true);
    assert.equal(canAccess(MANAGER_ROLE, HISTORICAL_IMPORT_ROLES), true);
  });

  it("keeps the copilot off the manager and off read-only roles", () => {
    assert.equal(canAccess(OWNER_ROLE, COPILOT_PROPOSE_ROLES), true);
    assert.equal(canAccess(ACCOUNTANT_ROLE, COPILOT_PROPOSE_ROLES), true);
    assert.equal(canAccess(MANAGER_ROLE, COPILOT_PROPOSE_ROLES), false);
    // Proposing a draft is a write, so the read-only auditor is not added here
    // even though it can see the board.
    assert.equal(canAccess(AUDITOR_ROLE, COPILOT_PROPOSE_ROLES), false);
  });

  it("keeps khata opening import off supervisors and operators", () => {
    assert.equal(canAccess(SUPERVISOR_ROLE, HISTORICAL_IMPORT_ROLES), false);
    assert.equal(canAccess(OPERATOR_ROLE, HISTORICAL_IMPORT_ROLES), false);
    assert.equal(canAccess(OWNER_ROLE, HISTORICAL_IMPORT_ROLES), true);
    assert.equal(canAccess(SUPERVISOR_ROLE, BOOKS_STATEMENT_ROLES), true);
    assert.equal(canAccess(OPERATOR_ROLE, BOOKS_STATEMENT_ROLES), false);
  });
});
