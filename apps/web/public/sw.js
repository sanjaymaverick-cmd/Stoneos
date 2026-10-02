/*
 * StoneOS service worker.
 *
 * The job: a supervisor opens StoneOS in the office, walks onto the cutting
 * floor where there is no signal, and the app still opens. Writes queue in the
 * outbox (packages/sync-client) and flush when the network returns.
 *
 * The previous version cached only offline.html and never called cache.put, so
 * offline was a dead end: every request missed and the app showed a notice
 * instead of the app. Queued writes were safe but unreachable, because you
 * could not get to the screen that makes them.
 *
 * Three strategies, by what the request is:
 *
 *   /api/*                never touched. Reads must be fresh or fail, so the
 *                         app can tell the difference; writes are the outbox's
 *                         business, not the cache's.
 *   /_next/static/*       cache-first. Next.js content-hashes these, so a given
 *                         URL never changes contents.
 *   everything else (GET) network-first falling back to cache, and every
 *                         success is written to the cache on the way past.
 *                         Navigations give up on the network after a few
 *                         seconds: a weak yard signal can hang for a minute.
 *
 * After sign-in the app posts {type: "warm", urls} so every screen, and the
 * build files it needs, is stored before the signal drops — not only the
 * screens someone happened to open.
 *
 * Caching page HTML is safe here because it carries no user data: the shell
 * fetches /api/v1/auth/me with a bearer token after it loads. If a page ever
 * starts being rendered per-user on the server this must change, because a
 * cached page would then be served to the next person on a shared device.
 */

const CACHE = "stoneos-shell-v2";
const OFFLINE_URL = "/offline.html";
const NAVIGATION_TIMEOUT_MS = 4000;

/* Enough of the app to open cold with no network. */
const PRECACHE = [OFFLINE_URL, "/login", "/dashboard", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Added one at a time, so a single missing route cannot abort the install
      // and leave the device with no offline support at all.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** Immutable build output: same URL, same bytes, forever. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Anything the cache must not hold an opinion about. */
function isLiveData(url) {
  return url.pathname.startsWith("/api/");
}

/**
 * Only store what is safe to replay. An opaque cross-origin response hides its
 * status, and a redirect replayed from cache confuses navigation.
 */
function isCacheable(response) {
  return Boolean(response) && response.ok && response.type !== "opaque" && !response.redirected;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone());
  return response;
}

/** Reject if the network has not answered in time, where a timer exists. */
function withTimeout(promise, ms) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const pending = fetch(request);
    const response = await (request.mode === "navigate" ? withTimeout(pending, NAVIGATION_TIMEOUT_MS) : pending);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (networkError) {
    const hit = await cache.match(request);
    if (hit) return hit;

    // A navigation to a page never opened online: give them a shell that is
    // cached rather than a browser error, so the app starts and the queue is
    // reachable.
    if (request.mode === "navigate") {
      const shell = (await cache.match("/dashboard")) || (await cache.match("/login"));
      if (shell) return shell;
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw networkError;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isLiveData(url)) return;

  event.respondWith(isImmutableAsset(url) ? cacheFirst(request) : networkFirst(request));
});

/* Store every screen the app may open, plus the build files each one loads. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls));
  }
});

async function warm(urls) {
  const cache = await caches.open(CACHE);
  const seen = new Set();
  for (const url of urls) {
    try {
      const response = await fetch(new Request(url, { cache: "reload" }));
      if (!isCacheable(response)) continue;
      await cache.put(url, response.clone());
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
        const asset = match[1];
        if (seen.has(asset) || (await cache.match(asset))) continue;
        seen.add(asset);
        const file = await fetch(asset).catch(() => null);
        if (isCacheable(file)) await cache.put(asset, file);
      }
    } catch {
      // One screen failing to warm must not stop the rest.
    }
  }
}
