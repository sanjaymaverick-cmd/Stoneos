import {
  bindOutboxItem,
  collectRefs,
  flushOutbox,
  IndexedDbOutboxStore,
  indexedDbAvailable,
  LocalStorageOutboxStore,
  newOpId,
  pendingRef,
  ref,
  replayBody,
  resolveRefs,
  UnresolvedRefError,
  type OutboxActor,
  type OutboxItem,
  type OutboxStore,
} from "@stoneos/sync-client";

export { newOpId, pendingRef, ref };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ACTOR_KEY = "stoneos.actor";

const idb = typeof window !== "undefined" && indexedDbAvailable() ? new IndexedDbOutboxStore() : null;
export const outbox: OutboxStore = idb ?? new LocalStorageOutboxStore();

/** What a write returns when it was kept on the device instead of reaching the server. */
export interface Queued {
  queued: true;
  clientOpId: string;
  /** Shown in place of a server number until the write syncs, e.g. PEND-7F3A9C. */
  pendingRef: string;
}

export function isQueued(value: unknown): value is Queued {
  return Boolean(value && typeof value === "object" && (value as Queued).queued === true);
}

/** Extra options for a write. Fetch ignores unknown keys, so this rides on RequestInit. */
export interface WriteOptions extends RequestInit {
  /** Sensitive settings and AI requests must never be persisted or replayed offline. */
  onlineOnly?: boolean;
  /** What a person would call this write on the sync screen. */
  label?: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("stoneos.token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem("stoneos.token", token);
  else window.localStorage.removeItem("stoneos.token");
}

export function getActor(): OutboxActor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OutboxActor;
    if (!parsed.userId || !parsed.factoryId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setActor(actor: OutboxActor | null) {
  if (typeof window === "undefined") return;
  if (actor) window.localStorage.setItem(ACTOR_KEY, JSON.stringify(actor));
  else window.localStorage.removeItem(ACTOR_KEY);
}

/** Forget cached screens on sign-out so the next person on this phone sees none of them. */
export async function clearCachedReads() {
  await idb?.clearReads().catch(() => undefined);
}

async function send(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const { label: _label, ...rest } = init as WriteOptions;
  return fetch(`${apiUrl}${path}`, { ...rest, headers });
}

function parseBody(init: RequestInit): Record<string, unknown> {
  if (!init.body) return {};
  try {
    const parsed = JSON.parse(String(init.body));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Every write carries a key and the moment it was made.
 *
 * The key makes a resend safe: if the reply is lost the device sends again and the
 * server answers from its record instead of doing the work twice. The timestamp is
 * when the person did it, so work synced tomorrow still lands on today.
 */
function stampWrite(path: string, init: RequestInit): Record<string, unknown> {
  const body = parseBody(init);
  if (typeof body.clientOpId !== "string" || !body.clientOpId) body.clientOpId = newOpId();
  if (!path.includes("/auth/") && body.occurredAt == null) body.occurredAt = new Date().toISOString();
  return body;
}

async function queueWrite(path: string, method: OutboxItem["method"], body: Record<string, unknown>, label?: string): Promise<Queued> {
  const item = bindOutboxItem({ method, path, body, actor: getActor(), label });
  await outbox.put(item);
  return { queued: true, clientOpId: item.clientOpId, pendingRef: pendingRef(item.clientOpId) };
}

/**
 * Fill in references to earlier writes that have already synced.
 * Returns null when one of them is still queued, so this write must queue too.
 */
async function resolveSynced(path: string, body: Record<string, unknown>) {
  const parents = collectRefs(path, body);
  if (parents.length === 0) return { path, body };
  const found = new Map<string, unknown>();
  for (const id of parents) {
    const result = await outbox.getResult(id);
    if (!result) return null;
    found.set(id, result.body);
  }
  try {
    const lookup = (id: string) => found.get(id);
    return { path: resolveRefs(path, lookup), body: resolveRefs(body, lookup) };
  } catch (error) {
    if (error instanceof UnresolvedRefError) return null;
    throw error;
  }
}

let flushing: ReturnType<typeof flushOutbox> | null = null;

/** One flush at a time: two overlapping passes would send the same write twice. */
export function flushQueuedWrites() {
  flushing ??= runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

function runFlush() {
  return flushOutbox(
    outbox,
    async (item) => {
      const response = await send(item.path, {
        method: item.method,
        body: JSON.stringify(replayBody(item)),
      });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, body };
    },
    getActor(),
  );
}

function readKey(path: string): string {
  const actor = getActor();
  return `${actor?.factoryId ?? "-"}:${actor?.userId ?? "-"}:${path}`;
}

/**
 * Call the API.
 *
 * Reads are remembered per user, and when the network is gone the last good answer
 * is returned so the screen still has its dropdowns. Writes made offline — or whose
 * request never reached the server — are queued and return a `Queued` marker.
 */
export async function apiFetch<T = any>(path: string, init: WriteOptions = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const isAuth = path.includes("/auth/");

  if (!isWrite) return read<T>(path, init);
  if (isAuth || init.onlineOnly || /^\/api\/v1\/reports\/analytics\/(ask|settings|documents)(\/|$)/.test(path)) return direct<T>(path, init);

  const stamped = stampWrite(path, init);
  const ready = await resolveSynced(path, stamped);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || !ready) {
    return queueWrite(path, method as OutboxItem["method"], stamped, init.label) as Promise<T>;
  }
  try {
    const result = await direct<T>(ready.path, { ...init, body: JSON.stringify(ready.body) });
    // Online results are recorded too, so a later offline write can refer to them.
    await outbox
      .putResult({
        clientOpId: stamped.clientOpId as string,
        method: method as OutboxItem["method"],
        path: ready.path,
        status: 200,
        body: result,
        label: init.label,
        syncedAt: new Date().toISOString(),
      })
      .catch(() => undefined);
    return result;
  } catch (error) {
    const failed = error as Error & { status?: number };
    if (failed.status == null) {
      // Never reached the server, or the reply was lost. The key makes a resend safe.
      return queueWrite(path, method as OutboxItem["method"], stamped, init.label) as Promise<T>;
    }
    throw error;
  }
}

/**
 * Figures that must be live or absent: the dashboard, balances, books and GST.
 * Showing yesterday's outstanding as today's would be worse than showing nothing.
 * Only the lists a person needs to enter work (blocks, slabs, customers, machines,
 * workers) are kept for offline use.
 */
const LIVE_ONLY = /^\/api\/v1\/(reports|books|gst|recovery-ratio|dpr|audit)(\/|\?|$)/;

async function read<T>(path: string, init: RequestInit): Promise<T> {
  const cacheable = !LIVE_ONLY.test(path);
  try {
    const result = await direct<T>(path, init);
    if (cacheable) idb?.putRead(readKey(path), result).catch(() => undefined);
    return result;
  } catch (error) {
    const failed = error as Error & { status?: number };
    if (failed.status == null && idb && cacheable) {
      const cached = await idb.getRead<T>(readKey(path)).catch(() => undefined);
      if (cached) return cached.body;
    }
    throw error;
  }
}

async function direct<T>(path: string, init: RequestInit): Promise<T> {
  const response = await send(path, init);
  if (response.status === 401) {
    setToken(null);
    if (typeof window !== "undefined" && !path.includes("/auth/login")) {
      window.location.href = "/login";
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    const error = new Error(message ?? "Request failed") as Error & { status: number; body: unknown };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  if (typeof window !== "undefined") {
    flushQueuedWrites().catch(() => undefined);
  }
  return response.json() as Promise<T>;
}
