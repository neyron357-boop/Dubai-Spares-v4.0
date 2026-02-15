const APP_SHELL_CACHE = 'dubai-spares-shell-v3';
const RUNTIME_CACHE = 'dubai-spares-runtime-v3';
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.json', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png'];
const NEW_LEAD_NOTIFY_TAG = 'new-inquiry-leads';
const LEAD_CHECK_INTERVAL_MS = 20 * 1000;
let supabaseConfig = null;
let latestLeadIds = new Set();
let leadPollingTimer = null;
const SW_STATE_CONFIG_URL = '/__sw_state__/supabase-config';
const SW_STATE_LEADS_URL = '/__sw_state__/latest-leads';

const saveSwState = async (url, value) => {
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
};

const readSwState = async (url) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const response = await cache.match(url);
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const restoreLeadPollingState = async () => {
  if (!supabaseConfig) {
    const savedConfig = await readSwState(SW_STATE_CONFIG_URL);
    if (savedConfig?.url && savedConfig?.anonKey) supabaseConfig = savedConfig;
  }
  if (latestLeadIds.size === 0) {
    const savedLeadIds = await readSwState(SW_STATE_LEADS_URL);
    if (Array.isArray(savedLeadIds) && savedLeadIds.length > 0) {
      latestLeadIds = new Set(savedLeadIds.map((id) => String(id)));
    }
  }
};


const normalizeNotificationRoute = (route) => {
  if (!route || typeof route !== 'string') return '/';
  const cleaned = route.trim();
  if (!cleaned) return '/';
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      const parsed = new URL(cleaned);
      return normalizeNotificationRoute(parsed.hash?.replace(/^#/, '') || parsed.pathname || '/');
    } catch {
      return '/';
    }
  }
  const noHash = cleaned.startsWith('#') ? cleaned.slice(1) : cleaned;
  if (noHash.startsWith('/orders/')) return noHash.replace('/orders/', '/order/');
  if (noHash.startsWith('/order/')) return noHash;
  if (noHash.startsWith('/notifications')) return noHash;
  if (noHash.startsWith('/')) return noHash;
  return `/${noHash}`;
};

const showTaggedNotification = async (title, options = {}) => {
  await self.registration.showNotification(title, {
    badge: '/icon-192.png',
    icon: '/icon-192.png',
    silent: false,
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
  event.waitUntil(
    restoreLeadPollingState().then(() => startLeadPolling())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'supabase-config' && data.url && data.anonKey) {
    supabaseConfig = { url: data.url, anonKey: data.anonKey };
    event.waitUntil(saveSwState(SW_STATE_CONFIG_URL, supabaseConfig));
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
  await restoreLeadPollingState();
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

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'lead-notification-sound', count: newRows.length }));
  }

  latestLeadIds = current;
  await saveSwState(SW_STATE_LEADS_URL, Array.from(current));
};

const startLeadPolling = () => {
  if (!supabaseConfig) return;
  if (leadPollingTimer) clearInterval(leadPollingTimer);
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
        .catch(async () => (await caches.match(request)) || new Response('Offline', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => (await caches.match(request)) || (await caches.match('/index.html')) || new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
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
    event.waitUntil(notifyAboutNewLeads().then(() => startLeadPolling()));
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'leads-periodic-sync') {
    event.waitUntil(notifyAboutNewLeads());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = normalizeNotificationRoute(event.notification.data?.route || event.notification.data?.url || '/');
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
