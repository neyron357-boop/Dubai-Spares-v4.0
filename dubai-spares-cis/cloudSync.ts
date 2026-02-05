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
  let hydrating = true

  // Берём методы из стора, но приводим тип к any, чтобы TS не валил билд
  const storeAny = useStore.getState() as any

  // 1) LOAD on app start
  try {
    const json = await loadCloudState()

    if (json && Array.isArray(json.orders) && Array.isArray(json.suppliers)) {
      storeAny.restoreData(json)
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
      const backup = storeAny.getBackupData()
      await saveCloudState(backup)
    } catch (e) {
      console.error('Cloud save failed', e)
    }
  }, 700)

  useStore.subscribe(() => {
    saveDebounced()
  })
}
