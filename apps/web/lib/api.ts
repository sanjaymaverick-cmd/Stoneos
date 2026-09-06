import {
  bindOutboxItem,
  flushOutbox,
  LocalStorageOutboxStore,
  replayBody,
  type OutboxActor,
  type OutboxItem,
} from "@stoneos/sync-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ACTOR_KEY = "stoneos.actor";
export const outbox = new LocalStorageOutboxStore();

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

async function send(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${apiUrl}${path}`, { ...init, headers });
}

function parseBody(init: RequestInit): unknown {
  if (!init.body) return {};
  try {
    return JSON.parse(String(init.body));
  } catch {
    return {};
  }
}

async function queueWrite(path: string, method: OutboxItem["method"], init: RequestInit) {
  const item = bindOutboxItem({
    method,
    path,
    body: parseBody(init),
    actor: getActor(),
  });
  await outbox.put(item);
  return { queued: true, clientOpId: item.clientOpId };
}

export async function flushQueuedWrites() {
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

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const isAuth = path.includes("/auth/");

  if (isWrite && !isAuth && typeof navigator !== "undefined" && navigator.onLine === false) {
    return queueWrite(path, method as OutboxItem["method"], init) as Promise<T>;
  }

  try {
    const response = await send(path, init);
    if (response.status === 401) {
      setToken(null);
      if (typeof window !== "undefined" && !path.includes("/auth/login")) {
        window.location.href = "/login";
      }
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: response.statusText }));
      const error = new Error(body.message ?? "Request failed") as Error & { status: number; body: unknown };
      error.status = response.status;
      error.body = body;
      throw error;
    }
    if (typeof window !== "undefined") {
      flushQueuedWrites().catch(() => undefined);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    const failed = error as Error & { status?: number };
    if (isWrite && !isAuth && failed.status == null) {
      return queueWrite(path, method as OutboxItem["method"], init) as Promise<T>;
    }
    throw error;
  }
}
