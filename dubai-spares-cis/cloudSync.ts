import { useStore } from './store';
import { loadCloudState, saveCloudState } from './cloudState';

let started = false;

export async function startCloudSync() {
  if (started) return;
  started = true;

  const store = useStore;

  // 1) LOAD from cloud on startup
  let isHydrating = true;
  const cloud = await loadCloudState();

  if (cloud) {
    // ВАЖНО: используем твой механизм импорта/восстановления
    // В сторе у тебя уже есть restoreData(data: any)
    store.getState().restoreData(cloud);
    console.log('CLOUD: restored from Supabase');
  } else {
    console.log('CLOUD: nothing to restore (empty)');
  }

  isHydrating = false;

  // 2) SAVE to cloud on every change (debounced)
  let timer: any = null;

  store.subscribe((state, prevState) => {
    if (isHydrating) return;

    // Чтобы не сохранять на "пустом" старте:
    if (state === prevState) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        // ВАЖНО: используем твой механизм экспорта
        // В сторе у тебя есть exportData(): any
        const json = store.getState().exportData();
        await saveCloudState(json);
        console.log('CLOUD: saved');
      } catch (e) {
        console.error('CLOUD: save failed', e);
      }
    }, 800);
  });
}
