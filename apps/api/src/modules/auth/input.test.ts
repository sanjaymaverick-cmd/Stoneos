import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { readPassword, readStaffType, readUsername } from "./input";

test("username is stored in lower case", () => {
  assert.equal(readUsername("  Yard.Lead "), "yard.lead");
});

test("a short password is rejected", () => {
  assert.throws(() => readPassword("short"), BadRequestException);
});

test("staff logins are office or yard", () => {
  assert.equal(readStaffType("YARD"), "YARD");
  assert.throws(() => readStaffType("OWNER"), BadRequestException);
});
