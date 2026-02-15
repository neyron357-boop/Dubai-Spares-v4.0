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

