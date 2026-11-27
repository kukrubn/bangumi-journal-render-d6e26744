// Only this public page goes into Cache Storage. Signed-in pages, RSC requests,
// API responses and playback links go straight to their normal network handlers.
const prefix = "bangumi-journal-shell-";
const cacheName = prefix + "v1";
const fallback = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.add(
        new Request(fallback, { cache: "reload", credentials: "omit", redirect: "error" }),
      );
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(prefix) && key !== cacheName)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== "GET" ||
    req.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/")
  )
    return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(cacheName);
        return (await cache.match(fallback)) || Response.error();
      }
    })(),
  );
});
