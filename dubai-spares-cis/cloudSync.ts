import { loadCloudState, saveCloudState } from './cloudState';
import { exportData, restoreDataExternal, subscribeStore } from './store';

let started = false;

const SAVE_DEBOUNCE_MS = 800;
const TIMER_SAVE_MS = 30000;
const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 15000;

export async function startCloudSync() {
  if (started) return;
  started = true;

  console.log('☁️ Cloud sync started');

  let hydrating = true;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSave = false;
  let inFlight = false;
  let lastSavedSnapshot = '';
  let retryAttempt = 0;

  const scheduleRetry = () => {
    const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
    retryAttempt += 1;

    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      void triggerSave('retry');
    }, delay);

    console.warn(`☁️ Retry scheduled in ${delay}ms`);
  };

  const triggerSave = async (reason: string) => {
    if (hydrating) return;

    const data = exportData();
    const snapshot = JSON.stringify(data);

    if (snapshot === lastSavedSnapshot && reason !== 'retry') {
      return;
    }

    pendingSave = true;
    if (inFlight) return;

    inFlight = true;
    while (pendingSave) {
      pendingSave = false;

      const currentData = exportData();
      const currentSnapshot = JSON.stringify(currentData);
      if (currentSnapshot === lastSavedSnapshot) continue;

      try {
        await saveCloudState(currentData);
        lastSavedSnapshot = currentSnapshot;
        retryAttempt = 0;
        console.log(`☁️ Auto-saved (${reason})`);
      } catch (e) {
        console.error('Cloud save failed', e);
        pendingSave = true;
        scheduleRetry();
        break;
      }
    }

    inFlight = false;
  };

  // 1️⃣ LOAD from cloud once on start
  try {
    const cloud = await loadCloudState();
    if (cloud && Array.isArray(cloud.orders)) {
      restoreDataExternal(cloud);
      lastSavedSnapshot = JSON.stringify(exportData());
      console.log('☁️ Cloud data restored');
    }
  } catch (e) {
    console.error('Cloud load failed', e);
  } finally {
    hydrating = false;
  }

  // 2️⃣ SAVE on every change (debounced)
  subscribeStore(() => {
    if (hydrating) return;

    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      void triggerSave('change');
    }, SAVE_DEBOUNCE_MS);
  });

  // 3️⃣ SAVE every 30 seconds (safety net)
  setInterval(() => {
    void triggerSave('timer');
  }, TIMER_SAVE_MS);

  // 4️⃣ SAVE when tab is hidden / user leaves app
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void triggerSave('visibility');
    }
  });

  window.addEventListener('beforeunload', () => {
    void triggerSave('beforeunload');
  });

  // 5️⃣ SAVE after reconnect
  window.addEventListener('online', () => {
    void triggerSave('online');
  });
}
