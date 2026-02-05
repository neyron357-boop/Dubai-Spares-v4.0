import { loadCloudState, saveCloudState } from './cloudState';
import { exportData, restoreDataExternal, subscribeStore } from './store';

let started = false;

export async function startCloudSync() {
  if (started) return;
  started = true;

  console.log('☁️ Cloud sync started');

  let hydrating = true;

  // 1️⃣ LOAD from cloud once on start
  try {
    const cloud = await loadCloudState();
    if (cloud && Array.isArray(cloud.orders)) {
      restoreDataExternal(cloud);
      console.log('☁️ Cloud data restored');
    }
  } catch (e) {
    console.error('Cloud load failed', e);
  } finally {
    hydrating = false;
  }

  // 2️⃣ SAVE on every change (debounced)
  let changeTimer: any = null;

  subscribeStore(() => {
    if (hydrating) return;

    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(async () => {
      try {
        const data = exportData();
        await saveCloudState(data);
        console.log('☁️ Auto-saved (change)');
      } catch (e) {
        console.error('Cloud save failed', e);
      }
    }, 800); // сохраняем спустя 0.8 сек после изменений
  });

  // 3️⃣ SAVE every 30 seconds (safety net)
  setInterval(async () => {
    try {
      const data = exportData();
      await saveCloudState(data);
      console.log('☁️ Auto-saved (timer)');
    } catch (e) {
      console.error('Cloud save failed (timer)', e);
    }
  }, 30000); // ⏱ 30 секунд
}
