import './tailwind.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import { installRuntimeDiagnostics } from './runtimeDiagnostics';

installRuntimeDiagnostics();


const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

const root = ReactDOM.createRoot(rootElement);
const normalizedPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
const publicQuoteMatch = window.location.pathname.match(/^\/(?:order\/([^/]+)\/quote|quote\/([^/]+))\/?$/i);
const publicQuotePathParam = publicQuoteMatch ? (publicQuoteMatch[2] || publicQuoteMatch[1] || '').trim() : null;
const isPublicQuoteRoute = !!publicQuotePathParam || /^#\/(?:q|tracking)\//i.test(window.location.hash);

const updatePublicRouteLayout = () => {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  const isPublic = /\/(?:request|order-form|public-order-form)$/.test(path)
    || /^#\/(?:request|order-form|public-order-form|q|tracking)(?:[/?]|$)/.test(hash)
    || !!publicQuotePathParam;
  for (const element of [document.documentElement, document.body, rootElement]) {
    element.classList.toggle('public-order-form', isPublic);
  }
};

updatePublicRouteLayout();
window.addEventListener('hashchange', updatePublicRouteLayout);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
    {normalizedPath.endsWith('/request') || normalizedPath.endsWith('/order-form') || normalizedPath.endsWith('/public-order-form') ? <PublicOrderFormScreen /> : publicQuotePathParam ? <PublicQuoteScreen orderId={publicQuotePathParam} /> : <App />}
    </AppErrorBoundary>
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

if ('serviceWorker' in navigator && !isPublicQuoteRoute) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(async (registration) => {

      (window as any).forceServiceWorkerUpdate = async () => {
        const active = registration.active || registration.waiting;
        active?.postMessage({ type: 'FORCE_SW_UPDATE' });
        await registration.update();
      };

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
