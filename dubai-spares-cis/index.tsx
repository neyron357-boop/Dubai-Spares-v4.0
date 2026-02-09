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
    void navigator.serviceWorker.register('/sw.js');
  });
}
