import { startCloudSync } from './cloudSync'

startCloudSync().catch(console.error)

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { supabase } from './supabaseClient';

(async () => {
  try {
    const test = { ping: Date.now() };
    const { error } = await supabase
      .from('app_state')
      .upsert({ id: 'global', data: test }, { onConflict: 'id' });

    console.log('SUPABASE TEST UPSERT OK', test);
    if (error) console.error('SUPABASE TEST UPSERT ERROR', error);
  } catch (e) {
    console.error('SUPABASE TEST CATCH', e);
  }
})();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
