import './tailwind.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import { extractOrderIdFromQuoteSlug } from './shareUtils';
import { installRuntimeDiagnostics } from './runtimeDiagnostics';
import { offlineDb } from './storage/offlineDb';
import { logger } from './logging';

installRuntimeDiagnostics();


const syncAppHeight = () => {
  if (typeof window === 'undefined') return;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
};

syncAppHeight();
window.addEventListener('resize', syncAppHeight);
window.visualViewport?.addEventListener('resize', syncAppHeight);


const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

const root = ReactDOM.createRoot(rootElement);
const normalizedHash = window.location.hash.toLowerCase();
const isHashPublicOrderFormRoute = normalizedHash === '#/request' || normalizedHash === '#/order-form';
const normalizedPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
const isPublicOrderFormRoute = normalizedPath.endsWith('/request') || normalizedPath.endsWith('/order-form') || isHashPublicOrderFormRoute;
const publicQuoteMatch = window.location.pathname.match(/^\/(?:order\/([^/]+)\/quote|quote\/([^/]+))\/?$/i);
const publicQuotePathParam = publicQuoteMatch ? decodeURIComponent((publicQuoteMatch[2] || publicQuoteMatch[1] || '').trim()) : null;
const hashQuoteMatch = window.location.hash.match(/^#\/q\/([^/?#]+).*$/i);
const hashTrackingMatch = window.location.hash.match(/^#\/tracking\/([^/?#]+).*$/i);
const hashQuoteToken = hashQuoteMatch ? decodeURIComponent(hashQuoteMatch[1].trim()) : null;
const hashTrackingOrderId = hashTrackingMatch ? decodeURIComponent(hashTrackingMatch[1].trim()) : null;
const publicQuoteOrderId = publicQuotePathParam ? extractOrderIdFromQuoteSlug(publicQuotePathParam) : null;
const isPublicQuoteRoute = !!publicQuoteOrderId || !!hashQuoteToken || !!hashTrackingOrderId;
const isPublicScrollableRoute = isPublicOrderFormRoute || isPublicQuoteRoute;

const BOOT_RESET_MARKER = 'dubai-spares-public-route-hard-reset-done';

const deleteIndexedDbByName = (name: string) => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () => resolve();
  request.onblocked = () => resolve();
});

const clearApplicationStorage = async () => {
  const bootCleanupErrors: Array<{ step: string; message: string }> = [];
  const recordCleanupError = (step: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    bootCleanupErrors.push({ step, message });
  };

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
      recordCleanupError('service_worker_unregister', error);
    }
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (error) {
      recordCleanupError('cache_storage_clear', error);
    }
  }

  if ('indexedDB' in window) {
    try {
      await offlineDb.rebuildIndex();
    } catch (error) {
      recordCleanupError('offline_db_rebuild', error);
    }
  }

  if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      const names = (databases || [])
        .map((database) => database?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      await Promise.all(names.map((name) => deleteIndexedDbByName(name)));
    } catch (error) {
      recordCleanupError('indexeddb_delete_databases', error);
    }
  }

  try {
    window.localStorage.clear();
  } catch (error) {
    recordCleanupError('local_storage_clear', error);
  }

  try {
    window.sessionStorage.clear();
  } catch (error) {
    recordCleanupError('session_storage_clear', error);
  }

  if (bootCleanupErrors.length > 0) {
    void logger.warn('public-route:boot', 'Public route storage reset completed with recoverable errors', {
      errors: bootCleanupErrors
    });
  }
};

const hardResetPublicRouteOnBoot = async (): Promise<boolean> => {
  if (!isPublicOrderFormRoute && !isPublicQuoteRoute) return false;
  try {
    if (window.sessionStorage.getItem(BOOT_RESET_MARKER) === '1') return false;
  } catch (error) {
    void logger.warn('public-route:boot', 'Unable to read hard-reset session marker', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }

  await clearApplicationStorage();

  try {
    window.sessionStorage.setItem(BOOT_RESET_MARKER, '1');
  } catch (error) {
    void logger.warn('public-route:boot', 'Unable to persist hard-reset session marker, skipping reload to avoid blank screen loop', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }

  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.setTimeout(() => {
    if (document.visibilityState === 'hidden') return;
    window.location.reload();
  }, 800);
  window.location.replace(currentUrl);
  return true;
};

void (async () => {
  const isHardResetReloading = await hardResetPublicRouteOnBoot();
  if (isHardResetReloading) return;

  if (isPublicScrollableRoute) {
    document.documentElement.classList.add('public-order-form');
    document.body.classList.add('public-order-form');
    rootElement.classList.add('public-order-form');
  }

  root.render(
    <React.StrictMode>
      {isPublicOrderFormRoute ? <PublicOrderFormScreen /> : hashTrackingOrderId ? <PublicQuoteScreen orderId={hashTrackingOrderId} /> : hashQuoteToken ? <PublicQuoteScreen orderId={hashQuoteToken} /> : publicQuotePathParam ? <PublicQuoteScreen orderId={publicQuotePathParam} /> : <App />}
    </React.StrictMode>
  );
})();

let audioContext: AudioContext | null = null;
const playLeadAlertSound = () => {
  if (typeof window === 'undefined') return;
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  if (!audioContext) audioContext = new Context();
  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined);
  }

  const now = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.connect(audioContext.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

  const osc = audioContext.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1046, now);
  osc.frequency.exponentialRampToValueAtTime(1318, now + 0.22);
  osc.frequency.exponentialRampToValueAtTime(988, now + 0.45);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.65);
};

if ('serviceWorker' in navigator && !isPublicQuoteRoute) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then(async (registration) => {

      (window as any).forceServiceWorkerUpdate = async () => {
        const active = registration.active || registration.waiting;
        active?.postMessage({ type: 'FORCE_SW_UPDATE' });
        await registration.update();
      };
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'lead-notification-sound') {
          playLeadAlertSound();
        }
      });
    }).catch((error) => {
      console.warn('[sw] registration skipped:', error);
    });
  });
}
