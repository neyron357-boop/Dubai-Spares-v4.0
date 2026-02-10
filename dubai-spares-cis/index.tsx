import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

const root = ReactDOM.createRoot(rootElement);
const isPublicOrderFormRoute = window.location.pathname === '/request' || window.location.pathname === '/order-form';

if (isPublicOrderFormRoute) {
  document.documentElement.classList.add('public-order-form');
  document.body.classList.add('public-order-form');
  rootElement.classList.add('public-order-form');
}

root.render(
  <React.StrictMode>
    {isPublicOrderFormRoute ? <PublicOrderFormScreen /> : <App />}
  </React.StrictMode>
);

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
    });
  });
}
