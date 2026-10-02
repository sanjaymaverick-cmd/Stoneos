import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleRoutes, canAccessPath } from "./routePolicy.ts";
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
