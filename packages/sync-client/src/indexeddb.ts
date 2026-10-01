import {
  LOCAL_STORAGE_OUTBOX_KEY,
  LocalStorageOutboxStore,
  type OutboxItem,
  type OutboxStore,
  type SyncResult,
} from "./outbox";

const DB_NAME = "stoneos-sync";
const DB_VERSION = 1;
const ITEMS = "outbox";
const RESULTS = "results";
const READS = "reads";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export function indexedDbAvailable(factory: IDBFactory | undefined = globalThis.indexedDB): boolean {
  return typeof factory !== "undefined" && factory !== null;
}

/**
 * The outbox, its sync results, and cached reads, in IndexedDB.
 *
 * localStorage tops out around 5 MB and blocks the page on every write; a day of
 * offline dispatches with photos does not fit. On first open this moves anything
 * the old localStorage outbox still holds, so an upgrade never strands queued work.
 */
export class IndexedDbOutboxStore implements OutboxStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private factory: IDBFactory = globalThis.indexedDB,
    private legacy: OutboxStore | null = new LocalStorageOutboxStore(),
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: "clientOpId" });
          if (!db.objectStoreNames.contains(RESULTS)) db.createObjectStore(RESULTS, { keyPath: "clientOpId" });
          if (!db.objectStoreNames.contains(READS)) db.createObjectStore(READS, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).then(async (db) => {
        await this.migrate(db);
        return db;
      });
    }
    return this.db;
  }

  private async migrate(db: IDBDatabase) {
    if (!this.legacy) return;
    const items = await this.legacy.list();
    const results = await this.legacy.listResults();
    if (items.length === 0 && results.length === 0) return;
    const tx = db.transaction([ITEMS, RESULTS], "readwrite");
    for (const item of items) tx.objectStore(ITEMS).put(item);
    for (const row of results) tx.objectStore(RESULTS).put(row);
    await done(tx);
    // Only clear the old copy once the new one is committed.
    for (const item of items) await this.legacy.remove(item.clientOpId);
    await this.legacy.pruneResults(new Date(8.64e15));
    if (typeof localStorage !== "undefined" && items.length) localStorage.removeItem(LOCAL_STORAGE_OUTBOX_KEY);
  }

  private async all<T>(storeName: string): Promise<T[]> {
    const db = await this.open();
    return request(db.transaction(storeName, "readonly").objectStore(storeName).getAll() as IDBRequest<T[]>);
  }

  private async write(storeName: string, action: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(storeName, "readwrite");
    action(tx.objectStore(storeName));
    await done(tx);
  }

  async list(): Promise<OutboxItem[]> {
    return (await this.all<OutboxItem>(ITEMS)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  put(item: OutboxItem): Promise<void> {
    return this.write(ITEMS, (s) => s.put(item));
  }

  remove(clientOpId: string): Promise<void> {
    return this.write(ITEMS, (s) => s.delete(clientOpId));
  }

  async getResult(clientOpId: string): Promise<SyncResult | undefined> {
    const db = await this.open();
    return request(db.transaction(RESULTS, "readonly").objectStore(RESULTS).get(clientOpId) as IDBRequest<SyncResult | undefined>);
  }

  putResult(result: SyncResult): Promise<void> {
    return this.write(RESULTS, (s) => s.put(result));
  }

  async listResults(): Promise<SyncResult[]> {
    return (await this.all<SyncResult>(RESULTS)).sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
  }

  async pruneResults(before: Date): Promise<void> {
    const cutoff = before.toISOString();
    const stale = (await this.all<SyncResult>(RESULTS)).filter((r) => r.syncedAt < cutoff);
    if (stale.length) await this.write(RESULTS, (s) => stale.forEach((r) => s.delete(r.clientOpId)));
  }

  /** Last good answer for a GET, so screens still have their lists offline. */
  async getRead<T = unknown>(key: string): Promise<{ key: string; body: T; savedAt: string } | undefined> {
    const db = await this.open();
    return request(db.transaction(READS, "readonly").objectStore(READS).get(key) as IDBRequest<{ key: string; body: T; savedAt: string } | undefined>);
  }

  putRead(key: string, body: unknown): Promise<void> {
    return this.write(READS, (s) => s.put({ key, body, savedAt: new Date().toISOString() }));
  }

  /** Drop every cached read, e.g. on sign-out, so the next person never sees them. */
  clearReads(): Promise<void> {
    return this.write(READS, (s) => s.clear());
  }
}
