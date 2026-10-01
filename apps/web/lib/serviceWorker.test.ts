import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, beforeEach } from "node:test";
import path from "node:path";
import vm from "node:vm";

/**
 * The service worker is plain JS served from /public, so it is loaded here into
 * a stubbed worker global and driven directly.
 *
 * What this pins is the defect it was written to fix: the old worker cached only
 * offline.html and never called cache.put, so walking out of signal and
 * reopening StoneOS gave a notice instead of the app — and the queued writes
 * inside were unreachable.
 */

const SW_SOURCE = readFileSync(
  path.join(import.meta.dirname, "..", "public", "sw.js"),
  "utf8",
);

type Handler = (event: any) => void;

class FakeCache {
  store = new Map<string, any>();
  puts: string[] = [];
  added: string[] = [];

  async match(request: any) {
    return this.store.get(keyOf(request));
  }
  async put(request: any, response: any) {
    this.puts.push(keyOf(request));
    this.store.set(keyOf(request), response);
  }
  async add(request: any) {
    this.added.push(keyOf(request));
    this.store.set(keyOf(request), response(200, `precached ${keyOf(request)}`));
  }
  seed(url: string, body: string) {
    this.store.set(url, response(200, body));
  }
}

function keyOf(request: any): string {
  const raw = typeof request === "string" ? request : request.url;
  return raw.startsWith("http") ? new URL(raw).pathname : raw;
}

function response(status: number, body: string, extra: Record<string, unknown> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    type: "basic",
    redirected: false,
    body,
    clone() {
      return { ...this };
    },
    ...extra,
  };
}

function request(url: string, init: { method?: string; mode?: string } = {}) {
  return { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" };
}

/** Load sw.js into a stub global and return the handlers plus the cache it uses. */
function loadWorker(networkImpl: (req: any) => Promise<any>) {
  const handlers: Record<string, Handler> = {};
  const cache = new FakeCache();
  const claimed = { skipWaiting: 0, clients: 0 };
  const waits: Promise<unknown>[] = [];

  const self: any = {
    location: { origin: "https://stoneos.test" },
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    skipWaiting: async () => {
      claimed.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        claimed.clients += 1;
      },
    },
  };

  const caches = {
    open: async () => cache,
    keys: async () => ["stoneos-shell-v1", "stoneos-shell-v2"],
    delete: async (k: string) => {
      deleted.push(k);
      return true;
    },
  };
  const deleted: string[] = [];

  const context: any = {
    self,
    caches,
    URL,
    Request: function (url: string, init: any) {
      return request(url, init);
    },
    fetch: networkImpl,
    Promise,
    Boolean,
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SW_SOURCE, context);

  const fire = async (type: string, event: any) => {
    handlers[type](event);
    await Promise.all(waits);
    waits.length = 0;
  };

  return { handlers, cache, claimed, deleted, fire, waits };
}

function fetchEvent(req: any, waits: Promise<unknown>[]) {
  const captured: { promise?: Promise<any> } = {};
  return {
    request: req,
    respondWith(p: Promise<any>) {
      captured.promise = p;
      waits.push(p.catch(() => undefined));
    },
    waitUntil(p: Promise<unknown>) {
      waits.push(p);
    },
    captured,
  };
}

describe("service worker", () => {
  let online: string[];

  beforeEach(() => {
    online = [];
  });

  const network = async (req: any) => {
    online.push(keyOf(req));
    return response(200, `live ${keyOf(req)}`);
  };
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };

  it("precaches the shell and takes over immediately", async () => {
    const w = loadWorker(network);
    const event = { waitUntil: (p: Promise<unknown>) => w.waits.push(p) };
    await w.fire("install", event);

    // The regression: the old worker precached ONE file, offline.html, so there
    // was never an app to open.
    assert.ok(w.cache.added.length > 1, `expected a real shell, got ${w.cache.added.join(", ")}`);
    assert.ok(w.cache.added.includes("/login"), "login must work on a cold device");
    assert.ok(w.cache.added.includes("/dashboard"), "and the dashboard shell");
    assert.ok(w.cache.added.includes("/offline.html"));
    assert.equal(w.claimed.skipWaiting, 1);
  });

  it("drops the previous cache version on activate", async () => {
    const w = loadWorker(network);
    await w.fire("activate", { waitUntil: (p: Promise<unknown>) => w.waits.push(p) });
    assert.deepEqual(w.deleted, ["stoneos-shell-v1"]);
    assert.equal(w.claimed.clients, 1);
  });

  it("never caches live data, writes, or another origin", async () => {
    const w = loadWorker(network);
    const untouched = [
      request("https://stoneos.test/api/v1/inventory/raw-blocks"),
      request("https://stoneos.test/sales", { method: "POST" }),
      request("https://cdn.example.com/x.js"),
    ];
    for (const req of untouched) {
      const event = fetchEvent(req, w.waits);
      w.handlers.fetch(event);
      assert.equal(event.captured.promise, undefined, `${req.url} must pass straight through`);
    }
  });

  it("stores what it fetches, so the next load works offline", async () => {
    const w = loadWorker(network);
    const event = fetchEvent(request("https://stoneos.test/production", { mode: "navigate" }), w.waits);
    w.handlers.fetch(event);
    const res = await event.captured.promise!;

    assert.equal(res.body, "live /production");
    // This is the whole fix: the old worker never called put.
    assert.ok(w.cache.puts.includes("/production"), `nothing was cached: ${w.cache.puts.join(", ")}`);
  });

  it("serves a visited page from cache when the network is gone", async () => {
    const w = loadWorker(offline);
    w.cache.seed("/production", "cached production page");
    const event = fetchEvent(request("https://stoneos.test/production", { mode: "navigate" }), w.waits);
    w.handlers.fetch(event);
    const res = await event.captured.promise!;
    assert.equal(res.body, "cached production page");
  });

  it("falls back to the dashboard shell for a page never opened online", async () => {
    const w = loadWorker(offline);
    w.cache.seed("/dashboard", "cached dashboard shell");
    const event = fetchEvent(request("https://stoneos.test/muster", { mode: "navigate" }), w.waits);
    w.handlers.fetch(event);
    const res = await event.captured.promise!;
    // The app opens, so the outbox is reachable — rather than a browser error.
    assert.equal(res.body, "cached dashboard shell");
  });

  it("falls back to the offline notice only when no shell is cached at all", async () => {
    const w = loadWorker(offline);
    w.cache.seed("/offline.html", "offline notice");
    const event = fetchEvent(request("https://stoneos.test/muster", { mode: "navigate" }), w.waits);
    w.handlers.fetch(event);
    const res = await event.captured.promise!;
    assert.equal(res.body, "offline notice");
  });

  it("serves hashed build assets from cache without touching the network", async () => {
    const w = loadWorker(network);
    const url = "https://stoneos.test/_next/static/chunks/abc123.js";
    w.cache.seed("/_next/static/chunks/abc123.js", "cached chunk");
    const event = fetchEvent(request(url), w.waits);
    w.handlers.fetch(event);
    const res = await event.captured.promise!;
    assert.equal(res.body, "cached chunk");
    assert.deepEqual(online, [], "an immutable asset must not be re-fetched");
  });

  it("refuses to store a failed or redirected response", async () => {
    const w = loadWorker(async () => response(500, "boom"));
    const event = fetchEvent(request("https://stoneos.test/books", { mode: "navigate" }), w.waits);
    w.handlers.fetch(event);
    await event.captured.promise!;
    assert.deepEqual(w.cache.puts, [], "a 500 must never become the cached page");

    const r = loadWorker(async () => response(200, "login redirect", { redirected: true }));
    const e2 = fetchEvent(request("https://stoneos.test/books", { mode: "navigate" }), r.waits);
    r.handlers.fetch(e2);
    await e2.captured.promise!;
    assert.deepEqual(r.cache.puts, [], "a redirect replayed from cache breaks navigation");
  });
});
