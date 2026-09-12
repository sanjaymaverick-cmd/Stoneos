import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessPath, visibleRoutes } from "./routePolicy.ts";

describe("route policy", () => {
  it("hides team access from operators", () => {
    const hrefs = visibleRoutes("operator").map((r) => r.href);
    assert.equal(hrefs.includes("/admin/users"), false);
    assert.equal(canAccessPath("operator", "/admin/users"), false);
    assert.equal(canAccessPath("owner", "/admin/users"), true);
  });

  it("hides sales from operators", () => {
    assert.equal(canAccessPath("operator", "/sales"), false);
    assert.equal(canAccessPath("sales", "/sales"), true);
  });

  it("hides tally import from supervisors", () => {
    assert.equal(canAccessPath("supervisor", "/tally"), false);
    assert.equal(canAccessPath("owner", "/tally"), true);
  });
});
