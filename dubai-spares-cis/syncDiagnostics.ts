export type SyncAction = 'retry' | 'reset_local_cache' | 'rebuild_index' | 'copy_diagnostics';

export interface NormalizedSyncError {
  code: string;
  message: string;
  humanMessage: string;
  actions: SyncAction[];
  raw?: unknown;
}

type SyncDiagnosticsState = {
  syncStatus: 'online' | 'syncing' | 'error' | 'offline';
  missingColumns: string[];
  lastSupabaseError: NormalizedSyncError | null;
  lastIndexedDbError: NormalizedSyncError | null;
};

const state: SyncDiagnosticsState = {
  syncStatus: navigator.onLine ? 'online' : 'offline',
  missingColumns: [],
  lastSupabaseError: null,
  lastIndexedDbError: null
};

export const setSyncStatus = (syncStatus: SyncDiagnosticsState['syncStatus']) => {
  state.syncStatus = syncStatus;
};

export const addMissingColumns = (columns: string[]) => {
  state.missingColumns = Array.from(new Set([...state.missingColumns, ...columns]));
};

export const setLastSupabaseError = (error: NormalizedSyncError | null) => {
  state.lastSupabaseError = error;
};

export const setLastIndexedDbError = (error: NormalizedSyncError | null) => {
  state.lastIndexedDbError = error;
};

export const getSyncDiagnosticsState = (): SyncDiagnosticsState => ({
  ...state,
  missingColumns: [...state.missingColumns]
});

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error || 'Unknown sync error');
};

export const normalizeSyncError = (error: unknown, fallback: string): NormalizedSyncError => {
  const baseMessage = getErrorMessage(error) || fallback;
  const normalizedMessage = baseMessage.toLowerCase();
  const errorCode = typeof error === 'object' && error && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'SYNC_UNKNOWN';


  if (
    /column does not exist|schema mismatch|schema cache/i.test(baseMessage)
    || errorCode === '42703'
    || errorCode === 'PGRST204'
    || errorCode === 'PGRST205'
  ) {
    return {
      code: 'SCHEMA_MISMATCH',
      message: baseMessage,
      humanMessage: 'Schema mismatch detected. Apply migrations and refresh Supabase schema cache before retrying sync.',
      actions: ['copy_diagnostics'],
      raw: error
    };
  }

  if (errorCode === 'PGRST204' || errorCode === 'PGRST205') {
    return {
      code: errorCode,
      message: baseMessage,
      humanMessage: 'Schema cache is stale. Run migrations, refresh Supabase schema cache, or wait 1–2 minutes.',
      actions: ['retry', 'copy_diagnostics'],
      raw: error
    };
  }

  if (/Indexed Database server lost|internal error.*indexed database|blocked/i.test(baseMessage)) {
    return {
      code: 'IDB_CONNECTION_LOST',
      message: baseMessage,
      humanMessage: 'Local IndexedDB is unstable. Retry sync or rebuild local index if the issue persists.',
      actions: ['retry', 'rebuild_index', 'copy_diagnostics'],
      raw: error
    };
  }

  if (/queue limit reached/i.test(baseMessage)) {
    return {
      code: 'QUEUE_LIMIT_REACHED',
      message: baseMessage,
      humanMessage: 'Offline queue is full. Export backup, then clear/reset local cache.',
      actions: ['reset_local_cache', 'copy_diagnostics'],
      raw: error
    };
  }

  if (
    normalizedMessage.includes('load failed')
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('networkerror')
    || normalizedMessage.includes('network request failed')
  ) {
    return {
      code: 'SUPABASE_NETWORK_UNAVAILABLE',
      message: baseMessage,
      humanMessage: 'Не удалось подключиться к Supabase. Проверьте статус проекта в Supabase Dashboard и повторите синхронизацию через 1-2 минуты.',
      actions: ['retry', 'copy_diagnostics'],
      raw: error
    };
  }

  return {
    code: errorCode,
    message: baseMessage,
    humanMessage: fallback,
    actions: ['retry', 'copy_diagnostics'],
    raw: error
  };
};
