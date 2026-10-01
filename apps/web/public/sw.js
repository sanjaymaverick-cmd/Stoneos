// StoneOS offline shell.
//
// Pages are network-first so a deploy shows up at once, but every page that loads is
// kept so the yard can still open it with no signal. Next.js build files are named by
// content hash, so they are served from the cache first and never go stale. API calls
// are left alone: the app caches its own reads and queues its writes.

const VERSION = "v2";
const PAGES = `stoneos-pages-${VERSION}`;
const ASSETS = `stoneos-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((cache) => cache.addAll([OFFLINE_URL])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// After sign-in the app sends every screen the person may open, so they are on the
// phone before the signal drops rather than only after each has been visited.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls));
  }
});

async function warm(urls) {
  const pages = await caches.open(PAGES);
  const assets = await caches.open(ASSETS);
  const seen = new Set();
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) continue;
      await pages.put(pageKey(url), response.clone());
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
        const asset = match[1];
        if (seen.has(asset)) continue;
        seen.add(asset);
        if (await assets.match(asset)) continue;
        const file = await fetch(asset).catch(() => null);
        if (file && file.ok) await assets.put(asset, file);
      }
    } catch {
      // One screen failing to warm must not stop the rest.
    }
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(rsc(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/** Pages are stored by path alone, so `/sales?x=1` and `/sales` share one copy. */
function pageKey(input) {
  const url = new URL(input, self.location.origin);
  return url.pathname.replace(/\/$/, "") || "/";
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
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

async function page(request) {
  const cache = await caches.open(PAGES);
  const key = pageKey(request.url);
  try {
    // A weak yard signal can hang for a minute; fall back after a few seconds.
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) || (await cache.match("/dashboard")) || (await cache.match(OFFLINE_URL));
  }
}

async function rsc(request) {
  const cache = await caches.open(PAGES);
  const key = `${pageKey(request.url)}?rsc`;
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    // No saved payload: fail so Next.js falls back to loading the page itself,
    // which the navigation handler above can serve from the cache.
    return (await cache.match(key)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return hit || (await fresh) || Response.error();
}
