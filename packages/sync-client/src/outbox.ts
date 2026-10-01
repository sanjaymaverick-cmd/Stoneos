import { collectRefs, resolveRefs, UnresolvedRefError } from "./refs";

export type SyncStatus = "synced" | "pending" | "conflict" | "offline";

export const MAX_OUTBOX_ATTEMPTS = 8;

/** How long a synced result is kept for later writes and the sync screen. */
export const RESULT_RETENTION_MS = 30 * 24 * 3600 * 1000;

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
  /** What a person would call this write, e.g. "Invoice PEND-7F3A9C · Jaipur Traders". */
  label?: string;
  /** Earlier queued writes whose results this one's path or body refers to. */
  dependsOn?: string[];
}

/** What the server answered for a write that has left the queue. */
export interface SyncResult {
  clientOpId: string;
  method: OutboxItem["method"];
  path: string;
  status: number;
  body: unknown;
  label?: string;
  syncedAt: string;
}

export interface OutboxActor {
  userId: string;
  factoryId: string;
}

export interface OutboxStore {
  list(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(clientOpId: string): Promise<void>;
  getResult(clientOpId: string): Promise<SyncResult | undefined>;
  putResult(result: SyncResult): Promise<void>;
  listResults(): Promise<SyncResult[]>;
  /** Forget results synced before `before`. */
  pruneResults(before: Date): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();
  private results = new Map<string, SyncResult>();

  async list(): Promise<OutboxItem[]> {
    return [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async put(item: OutboxItem): Promise<void> {
    this.items.set(item.clientOpId, item);
  }

  async remove(clientOpId: string): Promise<void> {
    this.items.delete(clientOpId);
  }

  async getResult(clientOpId: string): Promise<SyncResult | undefined> {
    return this.results.get(clientOpId);
  }

  async putResult(result: SyncResult): Promise<void> {
    this.results.set(result.clientOpId, result);
  }

  async listResults(): Promise<SyncResult[]> {
    return [...this.results.values()].sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
  }

  async pruneResults(before: Date): Promise<void> {
    const cutoff = before.toISOString();
    for (const [key, row] of this.results) if (row.syncedAt < cutoff) this.results.delete(key);
  }
}

export const LOCAL_STORAGE_OUTBOX_KEY = "stoneos.outbox";
const STORAGE_KEY = LOCAL_STORAGE_OUTBOX_KEY;
const RESULTS_KEY = "stoneos.outbox.results";

/**
 * The original store. Kept as the fallback where IndexedDB is unavailable and as
 * the source the IndexedDB store migrates from. It holds a few megabytes at most,
 * so it cannot carry photos or a long offline spell.
 */
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

  private readResults(): SyncResult[] {
    if (typeof localStorage === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(RESULTS_KEY) ?? "[]") as SyncResult[];
    } catch {
      return [];
    }
  }

  private writeResults(rows: SyncResult[]) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RESULTS_KEY, JSON.stringify(rows));
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

  async getResult(clientOpId: string): Promise<SyncResult | undefined> {
    return this.readResults().find((row) => row.clientOpId === clientOpId);
  }

  async putResult(result: SyncResult): Promise<void> {
    this.writeResults([...this.readResults().filter((r) => r.clientOpId !== result.clientOpId), result]);
  }

  async listResults(): Promise<SyncResult[]> {
    return this.readResults().sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
  }

  async pruneResults(before: Date): Promise<void> {
    const cutoff = before.toISOString();
    this.writeResults(this.readResults().filter((r) => r.syncedAt >= cutoff));
  }
}

export interface FlushResult {
  flushed: number;
  conflicts: number;
  failed: number;
  skipped: number;
  /** Held back because the session is not usable — not counted as a failure. */
  blocked: number;
  /** Waiting for an earlier queued write they refer to. */
  waiting: number;
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

/** A key to name a write before it is queued, so later writes can refer to it. */
export function newOpId(): string {
  return newClientOpId();
}

/** Queue a write with a stable clientOpId injected into the body. */
export function bindOutboxItem(input: {
  method: OutboxItem["method"];
  path: string;
  body: unknown;
  actor?: OutboxActor | null;
  label?: string;
}): OutboxItem {
  const body =
    input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? { ...(input.body as Record<string, unknown>) }
      : {};
  const existing = body.clientOpId;
  const clientOpId = typeof existing === "string" && existing.length > 0 ? existing : newClientOpId();
  body.clientOpId = clientOpId;
  const dependsOn = collectRefs(input.path, body);
  return {
    clientOpId,
    method: input.method,
    path: input.path,
    body,
    createdAt: new Date().toISOString(),
    attempts: 0,
    userId: input.actor?.userId,
    factoryId: input.actor?.factoryId,
    ...(input.label ? { label: input.label } : {}),
    ...(dependsOn.length ? { dependsOn } : {}),
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

/**
 * Send queued writes in the order they were made.
 *
 * A write that refers to an earlier one (`ref()`) waits until that one has synced,
 * then goes out with the real id filled in. If the earlier one can never sync, the
 * later one is parked as a conflict rather than sent with a hole in it.
 */
export async function flushOutbox(
  store: OutboxStore,
  send: (item: OutboxItem) => Promise<{ ok: boolean; status: number; body: unknown }>,
  actor?: OutboxActor | null,
): Promise<FlushResult> {
  const result: FlushResult = { flushed: 0, conflicts: 0, failed: 0, skipped: 0, blocked: 0, waiting: 0 };
  const queued = await store.list();
  // Kept current as the loop marks items, so a child sees its parent fail in the same pass.
  const state = new Map(queued.map((row) => [row.clientOpId, row]));
  const put = async (row: OutboxItem) => {
    state.set(row.clientOpId, row);
    await store.put(row);
  };

  for (const original of queued) {
    const item = state.get(original.clientOpId) ?? original;
    if (item.dead || item.conflict) {
      result.skipped += 1;
      continue;
    }
    if (!actorMatches(item, actor)) {
      result.skipped += 1;
      continue;
    }
    if (item.attempts >= MAX_OUTBOX_ATTEMPTS) {
      await put({ ...item, dead: true, heldForAuth: false, lastError: "retry cap" });
      result.failed += 1;
      continue;
    }

    const parents = item.dependsOn ?? collectRefs(item.path, item.body);
    const parentResults = new Map<string, unknown>();
    let parentState: "ready" | "waiting" | "failed" = "ready";
    let failedParentId: string | undefined;
    for (const parentId of parents) {
      const synced = await store.getResult(parentId);
      if (synced) {
        parentResults.set(parentId, synced.body);
        continue;
      }
      const parent = state.get(parentId);
      if (parent && !parent.dead && !parent.conflict) {
        parentState = "waiting";
        continue;
      }
      parentState = "failed";
      failedParentId = parentId;
      break;
    }
    if (parentState === "failed") {
      // The step this builds on will never land, so neither can this. A person decides.
      const parent = failedParentId ? state.get(failedParentId) : undefined;
      await put({
        ...item,
        conflict: {
          code: "PARENT_FAILED",
          parent: failedParentId,
          parentLabel: parent?.label,
          reason: parent?.lastError ?? "the earlier step was discarded",
        },
        lastError: "earlier step failed",
      });
      result.conflicts += 1;
      continue;
    }
    if (parentState === "waiting") {
      result.waiting += 1;
      continue;
    }

    let outgoing: OutboxItem = item;
    if (parents.length) {
      try {
        const lookup = (id: string) => parentResults.get(id);
        outgoing = { ...item, path: resolveRefs(item.path, lookup), body: resolveRefs(item.body, lookup) };
      } catch (error) {
        if (!(error instanceof UnresolvedRefError)) throw error;
        await put({
          ...item,
          conflict: { code: "PARENT_RESULT_MISSING", parent: error.clientOpId, field: error.field },
          lastError: error.message,
        });
        result.conflicts += 1;
        continue;
      }
    }

    let response: { ok: boolean; status: number; body: unknown };
    try {
      response = await send(outgoing);
    } catch (error) {
      await put({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : "network error",
      });
      result.failed += 1;
      continue;
    }
    if (response.ok) {
      await store.putResult({
        clientOpId: item.clientOpId,
        method: item.method,
        path: outgoing.path,
        status: response.status,
        body: response.body,
        label: item.label,
        syncedAt: new Date().toISOString(),
      });
      await store.remove(item.clientOpId);
      state.delete(item.clientOpId);
      result.flushed += 1;
      continue;
    }
    if (isAuthFailure(response.status)) {
      // Not an attempt. The write is fine; there is nobody to send it as.
      await put({ ...item, heldForAuth: true, lastError: `HTTP ${response.status}` });
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
      next.conflict = response.body;
      result.failed += 1;
    } else {
      result.failed += 1;
    }
    await put(next);
  }
  await store.pruneResults(new Date(Date.now() - RESULT_RETENTION_MS));
  return result;
}

/** Put a conflicted or dead write back in line, e.g. after its parent was fixed. */
export async function retryOutboxItem(store: OutboxStore, clientOpId: string): Promise<void> {
  const item = (await store.list()).find((row) => row.clientOpId === clientOpId);
  if (!item) return;
  const { conflict: _conflict, dead: _dead, lastError: _lastError, ...rest } = item;
  await store.put({ ...rest, attempts: 0 });
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
