const APP_SHELL_CACHE = 'dubai-spares-shell-v5';
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.json', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== APP_SHELL_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'FORCE_SW_UPDATE') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      self.skipWaiting();
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/') || url.hostname !== self.location.hostname) {
    return;
  }

  const isStaticAsset = request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font' || request.destination === 'document';
  if (!isStaticAsset) return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const cloned = response.clone();
      caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, cloned));
    }
    return response;
  })));
});
