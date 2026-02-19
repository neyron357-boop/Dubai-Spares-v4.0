import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import { extractOrderIdFromQuoteSlug } from './shareUtils';
import { installRuntimeDiagnostics } from './runtimeDiagnostics';

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
    });
  });
}
