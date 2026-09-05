import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createObjectStorage, LocalDiskStorage } from "./index.ts";

describe("object storage port", () => {
  it("round-trips local files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stoneos-storage-"));
    try {
      const storage = new LocalDiskStorage(dir);
      await storage.put({
        key: "factory/a/photo.jpg",
        contentType: "image/jpeg",
        bytes: Buffer.from("jpeg"),
      });
      const got = await storage.get("factory/a/photo.jpg");
      assert.equal(got.contentType, "image/jpeg");
      assert.equal(got.bytes.toString(), "jpeg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("selects the S3-compatible driver for OCI and AWS", () => {
    assert.equal(
      createObjectStorage({ STORAGE_DRIVER: "s3", S3_BUCKET: "stoneos" }).constructor.name,
      "S3CompatibleStorage",
    );
  });
});
