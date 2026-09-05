import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "./password.ts";
import { createSessionToken, hashSessionToken } from "./session-token.ts";

describe("passwords", () => {
  it("never stores plaintext and verifies the original", async () => {
    const encoded = await hashPassword("ChangeMeNow!12");
    assert.equal(encoded.includes("ChangeMeNow!12"), false);
    assert.equal(await verifyPassword("ChangeMeNow!12", encoded), true);
    assert.equal(await verifyPassword("wrong-password", encoded), false);
  });

  it("generates a temporary password of usable length", () => {
    assert.ok(generateTemporaryPassword().length >= 12);
  });
});

describe("sessions", () => {
  it("hashes opaque tokens", () => {
    const token = createSessionToken();
    const hashed = hashSessionToken(token);
    assert.notEqual(token, hashed);
    assert.equal(hashed.length, 64);
  });
});
