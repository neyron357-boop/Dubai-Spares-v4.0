const APP_SHELL_CACHE = 'dubai-spares-shell-v8';
const RUNTIME_IMAGE_CACHE = 'dubai-spares-runtime-images-v1';
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.json', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const keep = new Set([APP_SHELL_CACHE, RUNTIME_IMAGE_CACHE]);
    await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)));
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

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cloned = response.clone();
      caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, cloned));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  const isSupabaseStorage = url.pathname.includes('/storage/v1/object/');
  if (isSupabaseStorage && request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_IMAGE_CACHE);
      const cached = await cache.match(request);
      const networkPromise = fetch(request).then((response) => {
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }

      const network = await networkPromise;
      if (network) return network;
      return Response.error();
    })());
    return;
  }

  if (url.pathname.startsWith('/rest/v1/') || url.hostname !== self.location.hostname) {
    return;
  }

  const isStaticAsset = request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font' || request.destination === 'document';
  if (!isStaticAsset) return;

  event.respondWith(networkFirst(request));
});
