import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { Role } from "@stoneos/contracts";
import { assertAllowedRoles, assertDailyAccess } from "./session.guard.ts";

describe("deny-by-default roles", () => {
  it("rejects a missing annotation", () => {
    assert.throws(
      () => assertAllowedRoles(undefined, "operator"),
      ForbiddenException,
    );
    assert.throws(() => assertAllowedRoles([], "owner"), ForbiddenException);
  });

  it("rejects an operator on CEO routes", () => {
    assert.throws(
      () =>
        assertAllowedRoles(
          ["owner", "manager", "accountant", "auditor", "admin"],
          "operator",
        ),
      ForbiddenException,
    );
  });

  it("refuses a manager the executive board but not the commercial routes", () => {
    // The owner dashboard and Copilot are owner + auditor only; a manager keeps
    // everything below, which is where the trial balance and AR live.
    const executive: Role[] = ["owner", "auditor"];
    const commercial: Role[] = [
      "owner",
      "manager",
      "accountant",
      "auditor",
      "admin",
    ];
    assert.throws(
      () => assertAllowedRoles(executive, "manager"),
      ForbiddenException,
    );
    assert.throws(
      () => assertAllowedRoles(executive, "admin"),
      ForbiddenException,
    );
    assert.throws(
      () => assertAllowedRoles(executive, "accountant"),
      ForbiddenException,
    );
    assert.doesNotThrow(() => assertAllowedRoles(executive, "owner"));
    assert.doesNotThrow(() => assertAllowedRoles(executive, "auditor"));
    assert.doesNotThrow(() => assertAllowedRoles(commercial, "manager"));
  });

  it("allows an owner on CEO routes", () => {
    assert.doesNotThrow(() =>
      assertAllowedRoles(
        ["owner", "manager", "accountant", "auditor", "admin"],
        "owner",
      ),
    );
  });
});

describe("daily role boundaries", () => {
  it("refuses supervisor settings and user issuance", () => {
    assert.throws(
      () => assertDailyAccess("supervisor", "GET", "/api/v1/admin/users"),
      ForbiddenException,
    );
    assert.throws(
      () => assertDailyAccess("supervisor", "POST", "/api/v1/admin/users"),
      ForbiddenException,
    );
  });
  it("maps historic operational and owner roles", () => {
    assert.doesNotThrow(() =>
      assertDailyAccess("admin", "POST", "/api/v1/admin/users"),
    );
    assert.throws(
      () => assertDailyAccess("inventory", "POST", "/api/v1/admin/users"),
      ForbiddenException,
    );
  });
  it("keeps accountant and auditor read-only", () => {
    for (const r of ["accountant", "auditor"] as Role[]) {
      assert.doesNotThrow(() =>
        assertDailyAccess(r, "GET", "/api/v1/books/outstanding"),
      );
      assert.doesNotThrow(() => assertDailyAccess(r, "GET", "/api/v1/audit"));
      assert.throws(
        () => assertDailyAccess(r, "POST", "/api/v1/invoices/a/payments"),
        ForbiddenException,
      );
      assert.throws(
        () => assertDailyAccess(r, "POST", "/api/v1/books/copilot/propose"),
        ForbiddenException,
      );
    }
  });
  it("restricts operator writes to Cut and attendance", () => {
    assert.doesNotThrow(() =>
      assertDailyAccess(
        "operator",
        "POST",
        "/api/v1/cutting-sessions/a/complete",
      ),
    );
    assert.doesNotThrow(() =>
      assertDailyAccess("operator", "POST", "/api/v1/muster/attendance"),
    );
    assert.throws(
      () => assertDailyAccess("operator", "POST", "/api/v1/maintenance"),
      ForbiddenException,
    );
  });
});
