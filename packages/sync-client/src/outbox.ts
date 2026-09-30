export type SyncStatus = "synced" | "pending" | "conflict" | "offline";

export const MAX_OUTBOX_ATTEMPTS = 8;

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
  userId?: string;
  factoryId?: string;
  dead?: boolean;
  /**
   * Held because the session could not be used, not because the write is bad.
   * Cleared as soon as one flush gets past authentication.
   */
  heldForAuth?: boolean;
}

export interface OutboxActor {
  userId: string;
  factoryId: string;
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
  skipped: number;
  /** Held back because the session is not usable — not counted as a failure. */
  blocked: number;
}

/**
 * Does this status mean the write will never succeed, or only not right now?
 *
 * The distinction is the whole point. Treating every 4xx as permanent destroyed
 * queued work whenever a session expired: the shell flushes every few seconds, so
 * a supervisor whose token lapsed mid-shift lost the lot before they could log
 * back in, with nothing shown to anyone.
 *
 * - 401 is the session, never the write. It is retried forever and does not spend
 *   an attempt, because the queue must outlive a logged-out spell of any length.
 * - 403 is ambiguous — a forced password change looks identical to a genuine
 *   denial — so it is retried, but it *does* spend an attempt and dies at the cap.
 * - 408 and 429 are the server saying "later".
 * - Everything else in 4xx really is the request's fault.
 */
export function isPermanentFailure(status: number): boolean {
  if (status === 401 || status === 403) return false;
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** A 401 must not burn through the retry cap while nobody is logged in. */
export function isAuthFailure(status: number): boolean {
  return status === 401;
}

function newClientOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Queue a write with a stable clientOpId injected into the body. */
export function bindOutboxItem(input: {
  method: OutboxItem["method"];
  path: string;
  body: unknown;
  actor?: OutboxActor | null;
}): OutboxItem {
  const body =
    input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? { ...(input.body as Record<string, unknown>) }
      : {};
  const existing = body.clientOpId;
  const clientOpId = typeof existing === "string" && existing.length > 0 ? existing : newClientOpId();
  body.clientOpId = clientOpId;
  return {
    clientOpId,
    method: input.method,
    path: input.path,
    body,
    createdAt: new Date().toISOString(),
    attempts: 0,
    userId: input.actor?.userId,
    factoryId: input.actor?.factoryId,
  };
}

/** Replay must send the stored key, not mint a new one. */
export function replayBody(item: OutboxItem): unknown {
  if (item.body && typeof item.body === "object" && !Array.isArray(item.body)) {
    return { ...(item.body as Record<string, unknown>), clientOpId: item.clientOpId };
  }
  return item.body;
}

export function actorMatches(item: OutboxItem, actor?: OutboxActor | null): boolean {
  if (!item.userId && !item.factoryId) return true;
  if (!actor) return false;
  if (item.userId && item.userId !== actor.userId) return false;
  if (item.factoryId && item.factoryId !== actor.factoryId) return false;
  return true;
}

export async function flushOutbox(
  store: OutboxStore,
  send: (item: OutboxItem) => Promise<{ ok: boolean; status: number; body: unknown }>,
  actor?: OutboxActor | null,
): Promise<FlushResult> {
  const result: FlushResult = { flushed: 0, conflicts: 0, failed: 0, skipped: 0, blocked: 0 };
  for (const item of await store.list()) {
    if (item.dead || item.conflict) {
      result.skipped += 1;
      continue;
    }
    if (!actorMatches(item, actor)) {
      result.skipped += 1;
      continue;
    }
    if (item.attempts >= MAX_OUTBOX_ATTEMPTS) {
      await store.put({ ...item, dead: true, heldForAuth: false, lastError: "retry cap" });
      result.failed += 1;
      continue;
    }
    let response: { ok: boolean; status: number; body: unknown };
    try {
      response = await send(item);
    } catch (error) {
      await store.put({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : "network error",
      });
      result.failed += 1;
      continue;
    }
    if (response.ok) {
      await store.remove(item.clientOpId);
      result.flushed += 1;
      continue;
    }
    if (isAuthFailure(response.status)) {
      // Not an attempt. The write is fine; there is nobody to send it as.
      await store.put({ ...item, heldForAuth: true, lastError: `HTTP ${response.status}` });
      result.blocked += 1;
      continue;
    }
    const next: OutboxItem = {
      ...item,
      attempts: item.attempts + 1,
      lastError: `HTTP ${response.status}`,
      heldForAuth: false,
    };
    if (response.status === 409) {
      next.conflict = response.body;
      result.conflicts += 1;
    } else if (isPermanentFailure(response.status)) {
      next.dead = true;
      result.failed += 1;
    } else {
      result.failed += 1;
    }
    await store.put(next);
  }
  return result;
}

/**
 * What the queue actually holds, for a UI that must not say "synced" while work is
 * stuck. `dead` and `conflict` need a person; they are never cleared by waiting.
 */
export function summariseOutbox(items: OutboxItem[]): {
  pending: number;
  blocked: number;
  conflicts: number;
  dead: number;
  needsAttention: number;
} {
  let pending = 0;
  let blocked = 0;
  let conflicts = 0;
  let dead = 0;
  for (const item of items) {
    if (item.dead) dead += 1;
    else if (item.conflict) conflicts += 1;
    else if (item.heldForAuth) blocked += 1;
    else pending += 1;
  }
  return { pending, blocked, conflicts, dead, needsAttention: conflicts + dead };
}

export function nextRetryDelayMs(attempts: number): number {
  const base = Math.min(30_000, 500 * 2 ** Math.min(attempts, 6));
  return base + Math.floor(Math.random() * 250);
}
