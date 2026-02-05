import { useStore } from './store'
import { loadCloudState, saveCloudState } from './cloudState'

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: any
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export async function startCloudSync() {
  // 1) LOAD on app start
  let hydrating = true
  try {
    const json = await loadCloudState()

    // Твой импорт: restoreData(json)
    // (с проверкой формата как у тебя в SuppliersScreen)
    if (json && Array.isArray(json.orders) && Array.isArray(json.suppliers)) {
      useStore.getState().restoreData(json)
    }
  } catch (e) {
    console.error('Cloud load failed', e)
  } finally {
    hydrating = false
  }

  // 2) SAVE on any change (debounced)
  const saveDebounced = debounce(async () => {
    if (hydrating) return
    try {
      const backup = useStore.getState().getBackupData() // Твой export
      await saveCloudState(backup)
    } catch (e) {
      console.error('Cloud save failed', e)
    }
  }, 700)

  useStore.subscribe(() => {
    saveDebounced()
  })
}
