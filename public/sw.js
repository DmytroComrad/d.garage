// Офлайн-оболонка застосунку. Дані API сюди не потрапляють: їх кешує сам застосунок для свого користувача.
const CACHE = "garage-shell-v1";
const STATIC = ["/theme.js"];

/** Зберегти свіжу сторінку. Якщо вийшла нова збірка, докачати її файли й прибрати старі. */
async function updateShell(res) {
  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  const previous = await cache.match("/");
  const unchanged = previous && (await previous.text()) === html;
  await cache.put("/", res);
  if (unchanged) return;

  const current = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]));
  await cache.addAll([...current, ...STATIC]).catch(() => undefined);
  // Шрифти й ліниві частини в HTML не згадані: вони докачаються при першому ж використанні.
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/assets/") && !current.has(path)) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/", { cache: "no-cache" });
      if (res.ok) await updateShell(res);
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
          if (res.ok && url.pathname === "/") event.waitUntil(updateShell(res.clone()));
          return res;
        } catch {
          const cached = await caches.match("/");
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (STATIC.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) ?? Response.error()));
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
