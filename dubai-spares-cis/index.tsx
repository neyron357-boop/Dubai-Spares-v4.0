import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import { extractOrderIdFromQuoteSlug } from './shareUtils';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

const root = ReactDOM.createRoot(rootElement);
const isPublicOrderFormRoute = window.location.pathname === '/request' || window.location.pathname === '/order-form';
const publicQuoteMatch = window.location.pathname.match(/^\/(?:order\/([^/]+)\/quote|quote\/([^/]+))\/?$/i);
const publicQuoteOrderId = publicQuoteMatch ? extractOrderIdFromQuoteSlug(publicQuoteMatch[2] || publicQuoteMatch[1] || '') : null;
const isPublicScrollableRoute = isPublicOrderFormRoute || !!publicQuoteOrderId;

if (isPublicScrollableRoute) {
  document.documentElement.classList.add('public-order-form');
  document.body.classList.add('public-order-form');
  rootElement.classList.add('public-order-form');
}

root.render(
  <React.StrictMode>
    {isPublicOrderFormRoute ? <PublicOrderFormScreen /> : publicQuoteOrderId ? <PublicQuoteScreen orderId={publicQuoteOrderId} /> : <App />}
  </React.StrictMode>
);

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
      const swUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const swKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

      if (swUrl && swKey) {
        const pushConfig = () => {
          registration.active?.postMessage({ type: 'supabase-config', url: swUrl, anonKey: swKey });
          registration.waiting?.postMessage({ type: 'supabase-config', url: swUrl, anonKey: swKey });
          registration.installing?.postMessage({ type: 'supabase-config', url: swUrl, anonKey: swKey });
          registration.active?.postMessage({ type: 'start-lead-polling' });
        };
        pushConfig();
        window.setInterval(pushConfig, 60 * 1000);
      }

      if ('periodicSync' in registration) {
        try {
          await (registration as ServiceWorkerRegistration & { periodicSync: { register: (tag: string, options: { minInterval: number }) => Promise<void> } }).periodicSync.register('leads-periodic-sync', { minInterval: 5 * 60 * 1000 });
        } catch {
          // unsupported by browser permissions/policy
        }
      }

      if ('sync' in registration) {
        try {
          await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('leads-background-poll');
        } catch {
          // fallback to in-memory timer in SW
        }
      }

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'lead-notification-sound') {
          playLeadAlertSound();
        }
      });
    });
  });
}
