import { flushOutbox, LocalStorageOutboxStore, type OutboxItem } from "@stoneos/sync-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
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

async function send(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${apiUrl}${path}`, { ...init, headers });
}

export async function flushQueuedWrites() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { flushed: 0, conflicts: 0, failed: 0 };
  return flushOutbox(outbox, async (item) => {
    const response = await send(item.path, {
      method: item.method,
      body: JSON.stringify(item.body),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  });
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (typeof navigator !== "undefined" && !navigator.onLine && method !== "GET") {
    const item: OutboxItem = {
      clientOpId: crypto.randomUUID(),
      method: method as OutboxItem["method"],
      path,
      body: init.body ? JSON.parse(String(init.body)) : {},
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await outbox.put(item);
    return { queued: true, clientOpId: item.clientOpId } as T;
  }

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
}
