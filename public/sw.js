// Офлайн-оболонка застосунку. Дані API сюди не потрапляють: їх кешує сам застосунок для свого користувача.
const CACHE = "garage-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch("/", { cache: "no-cache" });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put("/", res);
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await cache.addAll(assets).catch(() => undefined);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok && url.pathname === "/") {
            const cache = await caches.open(CACHE);
            await cache.put("/", res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match("/");
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, res.clone());
        }
        return res;
      })(),
    );
  }
});
