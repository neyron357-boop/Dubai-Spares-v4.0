import '@fontsource-variable/manrope';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import { installRuntimeDiagnostics } from './runtimeDiagnostics';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import './tailwind.css';

installRuntimeDiagnostics();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

const root = ReactDOM.createRoot(rootElement);
const normalizedPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
const publicQuoteMatch = window.location.pathname.match(
  /^\/(?:order\/([^/]+)\/quote|quote\/([^/]+))\/?$/i,
);
const publicQuotePathParam = publicQuoteMatch
  ? (publicQuoteMatch[2] || publicQuoteMatch[1] || '').trim()
  : null;

const updatePublicRouteLayout = () => {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  const isPublic =
    /\/(?:request|order-form|public-order-form)$/.test(path) ||
    /^#\/(?:request|order-form|public-order-form|q|tracking)(?:[/?]|$)/.test(hash) ||
    !!publicQuotePathParam;
  for (const element of [document.documentElement, document.body, rootElement]) {
    element.classList.toggle('public-order-form', isPublic);
  }
};

updatePublicRouteLayout();
window.addEventListener('hashchange', updatePublicRouteLayout);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      {normalizedPath.endsWith('/request') ||
      normalizedPath.endsWith('/order-form') ||
      normalizedPath.endsWith('/public-order-form') ? (
        <PublicOrderFormScreen />
      ) : publicQuotePathParam ? (
        <PublicQuoteScreen orderId={publicQuotePathParam} />
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => console.warn('[offline] Cannot cache application', error));
  });
}
