const APP_SHELL_CACHE = 'dubai-spares-shell-v4';
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.json', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== APP_SHELL_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const isStaticAsset = ['style', 'script', 'image', 'font'].includes(request.destination);
  if (!isStaticAsset) {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((m) => m || new Response('Offline', { status: 503 }))));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const cloned = response.clone();
        caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, cloned));
        return response;
      });
    })
  );
});
