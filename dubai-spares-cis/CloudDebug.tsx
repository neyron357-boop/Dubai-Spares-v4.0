import React from 'react';
import { saveCloudState } from './cloudState';
import { exportData } from './store';

export default function CloudDebug() {
  const url = (import.meta as any).env?.VITE_SUPABASE_URL;
  const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;

  const onSave = async () => {
    try {
      const data = exportData();
      await saveCloudState(data);
      alert('✅ Saved to Supabase!');
    } catch (e: any) {
      alert('❌ Save failed: ' + (e?.message || String(e)));
      console.error(e);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 10,
      left: 10,
      right: 10,
      zIndex: 9999,
      background: 'white',
      border: '2px solid #000',
      padding: 10,
      borderRadius: 12,
      fontFamily: 'system-ui'
    }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        <b>Cloud Debug</b>
        <div>URL: {url ? '✅ OK' : '❌ MISSING'}</div>
        <div>KEY: {key ? '✅ OK' : '❌ MISSING'}</div>
      </div>

      <button
        onClick={onSave}
        style={{ width: '100%', padding: 10, fontWeight: 800 }}
      >
        SAVE TO SUPABASE NOW
      </button>
    </div>
  );
}
