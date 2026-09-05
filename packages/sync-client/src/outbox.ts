export type SyncStatus = "synced" | "pending" | "conflict" | "offline";

export interface OutboxItem {
  clientOpId: string;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body: unknown;
  baseVersion?: number;
  createdAt: string;
  attempts: number;
  lastError?: string;
  conflict?: unknown;
}

export interface OutboxStore {
  list(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(clientOpId: string): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();

  async list(): Promise<OutboxItem[]> {
    return [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async put(item: OutboxItem): Promise<void> {
    this.items.set(item.clientOpId, item);
  }

  async remove(clientOpId: string): Promise<void> {
    this.items.delete(clientOpId);
  }
}

const STORAGE_KEY = "stoneos.outbox";

export class LocalStorageOutboxStore implements OutboxStore {
  private read(): OutboxItem[] {
    if (typeof localStorage === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as OutboxItem[];
    } catch {
      return [];
    }
  }

  private write(items: OutboxItem[]) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  async list(): Promise<OutboxItem[]> {
    return this.read().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async put(item: OutboxItem): Promise<void> {
    const items = this.read().filter((row) => row.clientOpId !== item.clientOpId);
    items.push(item);
    this.write(items);
  }

  async remove(clientOpId: string): Promise<void> {
    this.write(this.read().filter((row) => row.clientOpId !== clientOpId));
  }
}

export interface FlushResult {
  flushed: number;
  conflicts: number;
  failed: number;
}

export async function flushOutbox(
  store: OutboxStore,
  send: (item: OutboxItem) => Promise<{ ok: boolean; status: number; body: unknown }>,
): Promise<FlushResult> {
  const result: FlushResult = { flushed: 0, conflicts: 0, failed: 0 };
  for (const item of await store.list()) {
    const response = await send(item);
    if (response.ok) {
      await store.remove(item.clientOpId);
      result.flushed += 1;
      continue;
    }
    const next: OutboxItem = {
      ...item,
      attempts: item.attempts + 1,
      lastError: `HTTP ${response.status}`,
    };
    if (response.status === 409) {
      next.conflict = response.body;
      result.conflicts += 1;
    } else {
      result.failed += 1;
    }
    await store.put(next);
  }
  return result;
}

export function nextRetryDelayMs(attempts: number): number {
  const base = Math.min(30_000, 500 * 2 ** Math.min(attempts, 6));
  return base + Math.floor(Math.random() * 250);
}
