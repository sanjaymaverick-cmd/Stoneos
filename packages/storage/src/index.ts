import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  key: string;
  contentType: string;
  bytes: Buffer;
}

export interface ObjectStorage {
  put(object: StoredObject): Promise<{ key: string }>;
  get(key: string): Promise<StoredObject>;
}

export class LocalDiskStorage implements ObjectStorage {
  constructor(private root: string) {}

  async put(object: StoredObject): Promise<{ key: string }> {
    const full = path.join(this.root, object.key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, object.bytes);
    await writeFile(`${full}.meta.json`, JSON.stringify({ contentType: object.contentType }));
    return { key: object.key };
  }

  async get(key: string): Promise<StoredObject> {
    const full = path.join(this.root, key);
    const bytes = await readFile(full);
    const meta = JSON.parse(await readFile(`${full}.meta.json`, "utf8")) as { contentType: string };
    return { key, contentType: meta.contentType, bytes };
  }
}

export interface S3LikeConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Port for Amazon S3 and OCI Object Storage (S3-compatible). */
export class S3CompatibleStorage implements ObjectStorage {
  constructor(private readonly config: S3LikeConfig) {
    if (!config.bucket) throw new Error("S3/OCI bucket is required");
  }

  async put(_object: StoredObject): Promise<{ key: string }> {
    throw new Error(
      `S3CompatibleStorage.put is wired through the cloud SDK at deploy time (bucket=${this.config.bucket})`,
    );
  }

  async get(_key: string): Promise<StoredObject> {
    throw new Error(
      `S3CompatibleStorage.get is wired through the cloud SDK at deploy time (bucket=${this.config.bucket})`,
    );
  }
}

export function createObjectStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "local") {
    return new LocalDiskStorage(env.STORAGE_LOCAL_DIR ?? "./var/storage");
  }
  if (driver === "s3" || driver === "oci") {
    return new S3CompatibleStorage({
      bucket: env.S3_BUCKET ?? "",
      region: env.S3_REGION ?? env.OCI_REGION ?? "",
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}
