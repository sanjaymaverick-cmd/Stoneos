import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleRoutes, canAccessPath } from "./routePolicy.ts";
import type { Role } from "@stoneos/contracts";
describe("yard navigation", () => {
  it("has exactly five primary destinations in order", () =>
    assert.deepEqual(
      visibleRoutes("owner").map((r) => r.label),
      ["Today", "Yard", "Cut", "Sell", "Money"],
    ));
  it("keeps supervisor out of Settings and money", () => {
    for (const p of ["/admin/users", "/admin/audit", "/expenses", "/books"])
      assert.equal(canAccessPath("supervisor", p), false);
  });
  it("limits operator to Cut and People actions", () => {
    assert.equal(canAccessPath("operator", "/production"), true);
    assert.equal(canAccessPath("operator", "/muster"), true);
    assert.equal(canAccessPath("operator", "/sales"), false);
  });
  it("keeps secondary pages out of primary chrome", () => {
    assert.equal(
      visibleRoutes("owner").some((r) =>
        [
          "/muster",
          "/maintenance",
          "/sync",
          "/setup/opening-inventory",
          "/recovery-ratio",
          "/intake",
        ].includes(r.href),
      ),
      false,
    );
  });
});

describe("lot screens", () => {
  it("follows the yard's roles", () => {
    // Counting and selling stock is floor work; the books roles have no business there.
    for (const role of ["owner", "manager", "supervisor", "inventory", "sales"] as Role[]) {
      assert.equal(canAccessPath(role, "/lots"), true, `${role} should reach /lots`);
      assert.equal(canAccessPath(role, "/lots/sell"), true, `${role} should reach /lots/sell`);
    }
    for (const role of ["accountant", "auditor", "operator"] as Role[]) {
      assert.equal(canAccessPath(role, "/lots"), false, `${role} should not reach /lots`);
      assert.equal(canAccessPath(role, "/lots/sell"), false, `${role} should not reach /lots/sell`);
    }
  });

  it("adds no sixth tab", () => {
    // The five primary destinations are the point of the Today/Yard/Cut/Sell/Money
    // layout. The lot screens hang off Yard and Sell instead of crowding the bar.
    const tabs = visibleRoutes("owner").map((r) => r.href);
    assert.equal(tabs.includes("/lots"), false);
    assert.equal(tabs.includes("/lots/sell"), false);
  });
});
