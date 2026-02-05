import { loadCloudState, saveCloudState } from './cloudState';
import { exportData, restoreDataExternal, subscribeStore } from './store';

let started = false;

export async function startCloudSync() {
  if (started) return;
  started = true;

  // ✅ Визуальный тест на телефоне (потом уберём)
  // alert('CLOUDSYNC STARTED');

  let hydrating = true;

  // 1) LOAD once
  try {
    const cloud = await loadCloudState();
    console.log('CLOUDSYNC LOADED', cloud);

    if (cloud && Array.isArray(cloud.orders)) {
      restoreDataExternal(cloud);
      console.log('CLOUDSYNC RESTORED');
    }
  } catch (e) {
    console.error('CLOUDSYNC LOAD/RESTORE FAILED', e);
    alert('Cloud load/restore failed. Check console.');
  } finally {
    hydrating = false;
  }

  // 2) SAVE on changes (debounced)
  let timer: any = null;

  subscribeStore(() => {
    if (hydrating) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const json = exportData();
        await saveCloudState(json);
        console.log('CLOUDSYNC SAVED');
      } catch (e) {
        console.error('CLOUDSYNC SAVE FAILED', e);
        alert('Cloud save failed. Check console.');
      }
    }, 800);
  });
}
