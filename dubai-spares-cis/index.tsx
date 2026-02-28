import './tailwind.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import { extractOrderIdFromQuoteSlug } from './shareUtils';
import { installRuntimeDiagnostics } from './runtimeDiagnostics';
import { offlineDb } from './storage/offlineDb';

installRuntimeDiagnostics();

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
const hashQuoteToken = hashQuoteMatch ? decodeURIComponent(hashQuoteMatch[1].trim()) : null;
const publicQuoteOrderId = publicQuotePathParam ? extractOrderIdFromQuoteSlug(publicQuotePathParam) : null;
const isPublicScrollableRoute = isPublicOrderFormRoute || !!publicQuoteOrderId || !!hashQuoteToken;

const BOOT_RESET_MARKER = 'dubai-spares-public-form-hard-reset-done';

const deleteIndexedDbByName = (name: string) => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () => resolve();
  request.onblocked = () => resolve();
});

const clearApplicationStorage = async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if ('indexedDB' in window) {
    await offlineDb.rebuildIndex();
  }

  if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    const names = (databases || [])
      .map((database) => database?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    await Promise.all(names.map((name) => deleteIndexedDbByName(name)));
  }

  window.localStorage.clear();
  window.sessionStorage.clear();
};

const hardResetPublicFormOnBoot = async (): Promise<void> => {
  if (!isPublicOrderFormRoute) return;
  if (window.sessionStorage.getItem(BOOT_RESET_MARKER) === '1') return;

  await clearApplicationStorage();

  window.sessionStorage.setItem(BOOT_RESET_MARKER, '1');
  window.location.replace(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  await new Promise<never>(() => undefined);
};

void (async () => {
  await hardResetPublicFormOnBoot();

  if (isPublicScrollableRoute) {
    document.documentElement.classList.add('public-order-form');
    document.body.classList.add('public-order-form');
    rootElement.classList.add('public-order-form');
  }

  root.render(
    <React.StrictMode>
      {isPublicOrderFormRoute ? <PublicOrderFormScreen /> : hashQuoteToken ? <PublicQuoteScreen orderId={hashQuoteToken} /> : publicQuotePathParam ? <PublicQuoteScreen orderId={publicQuotePathParam} /> : <App />}
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

if ('serviceWorker' in navigator) {
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
