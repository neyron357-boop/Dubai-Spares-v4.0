const APP_SHELL_CACHE = 'dubai-spares-shell-v3';
const RUNTIME_CACHE = 'dubai-spares-runtime-v3';
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.json', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png'];
const NEW_LEAD_NOTIFY_TAG = 'new-inquiry-leads';
const LEAD_CHECK_INTERVAL_MS = 60 * 1000;
let supabaseConfig = null;
let latestLeadIds = new Set();
let leadPollingTimer = null;

const showTaggedNotification = async (title, options = {}) => {
  await self.registration.showNotification(title, {
    badge: '/icon-192.png',
    icon: '/icon-192.png',
    renotify: true,
    requireInteraction: true,
    vibrate: [220, 120, 220],
    ...options
  });
};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'supabase-config' && data.url && data.anonKey) {
    supabaseConfig = { url: data.url, anonKey: data.anonKey };
    startLeadPolling();
  }
  if (data.type === 'start-lead-polling') startLeadPolling();

  if (data.type === 'notify-order') {
    event.waitUntil(
      showTaggedNotification(data.title || 'Новый заказ', {
        body: data.body || 'Появился новый заказ',
        tag: data.tag || 'order-alert',
        data: { url: data.url || '/', route: data.route || '/' },
        vibrate: [250, 120, 250, 120, 250]
      })
    );
  }

  if (data.type === 'notify-radar') {
    event.waitUntil(
      showTaggedNotification(data.title || 'Радар', {
        body: data.body || 'Рядом найден совместимый магазин',
        tag: data.tag || 'radar-alert',
        data: { url: data.url || '/', route: data.route || '/' },
        vibrate: [180, 80, 180]
      })
    );
  }
});

const fetchLeadIds = async () => {
  if (!supabaseConfig) return [];
  const endpoint = `${supabaseConfig.url}/rest/v1/orders?status=eq.new_inquiry&select=id,brand,model,created_at&order=created_at.desc&limit=20`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${supabaseConfig.anonKey}`
    }
  });
  if (!response.ok) throw new Error(`lead poll failed: ${response.status}`);
  return response.json();
};

const notifyAboutNewLeads = async () => {
  const rows = await fetchLeadIds();
  const current = new Set(rows.map((row) => String(row.id)));
  const newRows = rows.filter((row) => !latestLeadIds.has(String(row.id)));

  if (latestLeadIds.size > 0 && newRows.length > 0) {
    const top = newRows[0];
    const title = `Новый лид: ${top.brand || ''} ${top.model || ''}`.trim();
    await showTaggedNotification(title || 'Новый лид', {
      body: `Поступило новых заявок: ${newRows.length}`,
      tag: NEW_LEAD_NOTIFY_TAG,
      requireInteraction: true,
      vibrate: [250, 120, 250, 120, 250],
      renotify: true,
      data: { url: '/' }
    });
  }

  latestLeadIds = current;
};

const startLeadPolling = () => {
  if (leadPollingTimer || !supabaseConfig) return;
  const loop = async () => {
    try {
      await notifyAboutNewLeads();
    } catch {
      // ignore network errors
    }
  };
  void loop();
  leadPollingTimer = setInterval(() => {
    void loop();
  }, LEAD_CHECK_INTERVAL_MS);
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isStaticAsset =
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font';

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone));
          return response;
        });
      })
    );
    return;
  }

  const isApiCall = url.hostname.includes('supabase.co');
  if (isApiCall) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html')))
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'orders-background-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'flush-offline-mutations' }));
      })
    );
    return;
  }

  if (event.tag === 'leads-background-poll') {
    event.waitUntil(notifyAboutNewLeads());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'leads-periodic-sync') {
    event.waitUntil(notifyAboutNewLeads());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route || '/';
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) {
        existing.navigate(route.startsWith('#') ? route : `/#${route}`);
        return existing.focus();
      }
      return self.clients.openWindow(route.startsWith('#') ? route : `/#${route}`);
    })
  );
});
