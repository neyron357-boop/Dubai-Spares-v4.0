const BASE = new URL('./', self.location.href);
const CACHE = 'dubai-spares-local-v12';
const SHELL = [
  '',
  'index.html',
  'manifest.json',
  'icon-32.png',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
].map((path) => new URL(path, BASE).href);
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Vite lists all lazy chunks and fonts. Precache them so unvisited screens work offline too.
      const response = await fetch(new URL('offline-assets.json', BASE));
      if (response.ok) {
        const assets = await response.json();
        await cache.addAll(assets.map((path) => new URL(path, BASE).href));
      }
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('dubai-spares-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const { request } = event,
    url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== BASE.origin ||
    !url.pathname.startsWith(BASE.pathname)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (request.mode === 'navigate') {
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return (
            (await cache.match(new URL('index.html', BASE).href, { ignoreVary: true })) ||
            Response.error()
          );
        }
      }
      // Build assets are immutable and identical for every visitor.
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
