import { logger } from './logging';

export type SyncLogCategory = 'SYNC_STATE' | 'MUTATION_QUEUE' | 'IDB_TX' | 'SUPABASE_REQ' | 'SCHEMA_MISMATCH';

type PerfState = {
  typingSamplesMs: number[];
  idbWriteTimestamps: number[];
  networkRequestTimestamps: number[];
  queueLength: number;
  queueHistory: Array<{ at: number; length: number }>;
  lastSyncAt: number | null;
  retryCount: number;
  lastError: string | null;
  schemaWarnings: string[];
  idbOpenAttempts: number;
  idbVersion: number | null;
  idbTxTimestamps: number[];
  idbTxDurationsMs: number[];
  lastIdbError: string | null;
  idbEvents: Array<{ at: number; event: string; meta?: unknown }>;
  lastNetworkRequest: { at: number; operation: string; orderId?: string; bytes?: number } | null;
  activeRequest: boolean;
  lastErrorType: 'network' | 'schema' | 'unknown' | null;
  nextRetryAt: number | null;
};

const state: PerfState = {
  typingSamplesMs: [],
  idbWriteTimestamps: [],
  networkRequestTimestamps: [],
  queueLength: 0,
  queueHistory: [],
  lastSyncAt: null,
  retryCount: 0,
  lastError: null,
  schemaWarnings: [],
  idbOpenAttempts: 0,
  idbVersion: null,
  idbTxTimestamps: [],
  idbTxDurationsMs: [],
  lastIdbError: null,
  idbEvents: [],
  lastNetworkRequest: null,
  activeRequest: false,
  lastErrorType: null,
  nextRetryAt: null
};

const oneSecondAgo = () => Date.now() - 1000;

const trimOld = (arr: number[]) => {
  const border = oneSecondAgo();
  while (arr.length && arr[0] < border) arr.shift();
};

const sampledSignatures = new Map<string, number>();

export const logSyncCategory = (category: SyncLogCategory, message: string, meta?: unknown, dedupeMs = 4000) => {
  const signature = `${category}:${message}`;
  const now = Date.now();
  const previous = sampledSignatures.get(signature) || 0;
  if (now - previous < dedupeMs) return;
  sampledSignatures.set(signature, now);
  void logger.info(category, message, meta);
};

export const syncPerf = {
  recordTypingSample(durationMs: number) {
    state.typingSamplesMs.push(durationMs);
    if (state.typingSamplesMs.length > 200) state.typingSamplesMs.shift();
  },
  recordIdbWrite() {
    state.idbWriteTimestamps.push(Date.now());
    trimOld(state.idbWriteTimestamps);
  },
  recordNetworkRequest() {
    state.networkRequestTimestamps.push(Date.now());
    trimOld(state.networkRequestTimestamps);
  },
  setLastNetworkRequest(payload: { operation: string; orderId?: string; bytes?: number }) {
    state.lastNetworkRequest = { at: Date.now(), ...payload };
  },
  setQueueLength(length: number) {
    if (state.queueLength === length) return;
    state.queueLength = length;
    state.queueHistory.push({ at: Date.now(), length });
    if (state.queueHistory.length > 200) state.queueHistory.shift();
    logSyncCategory('MUTATION_QUEUE', 'queue_length_changed', { length });
  },
  markSynced() {
    state.lastSyncAt = Date.now();
  },
  markRetry() {
    state.retryCount += 1;
  },
  setLastError(message: string | null) {
    state.lastError = message;
  },
  setLastErrorType(type: 'network' | 'schema' | 'unknown' | null) {
    state.lastErrorType = type;
  },
  setNextRetryAt(value: number | null) {
    state.nextRetryAt = value;
  },
  setActiveRequest(active: boolean) {
    state.activeRequest = active;
  },
  addSchemaWarning(message: string) {
    if (state.schemaWarnings.includes(message)) return;
    state.schemaWarnings.push(message);
    logSyncCategory('SCHEMA_MISMATCH', 'schema_warning', { message }, 10000);
  },
  recordIdbOpenAttempt(dbVersion?: number) {
    state.idbOpenAttempts += 1;
    if (Number.isFinite(dbVersion)) state.idbVersion = Number(dbVersion);
  },
  recordIdbTransaction(durationMs: number) {
    state.idbTxTimestamps.push(Date.now());
    trimOld(state.idbTxTimestamps);
    state.idbTxDurationsMs.push(durationMs);
    if (state.idbTxDurationsMs.length > 300) state.idbTxDurationsMs.shift();
  },
  setLastIdbError(message: string | null) {
    state.lastIdbError = message;
  },
  addIdbEvent(event: string, meta?: unknown) {
    state.idbEvents.unshift({ at: Date.now(), event, meta });
    if (state.idbEvents.length > 20) state.idbEvents.length = 20;
  },
  snapshot() {
    trimOld(state.idbWriteTimestamps);
    trimOld(state.networkRequestTimestamps);
    const typingAvgMs = state.typingSamplesMs.length
      ? Math.round((state.typingSamplesMs.reduce((sum, value) => sum + value, 0) / state.typingSamplesMs.length) * 100) / 100
      : 0;
    const avgIdbTxMs = state.idbTxDurationsMs.length
      ? Math.round((state.idbTxDurationsMs.reduce((sum, value) => sum + value, 0) / state.idbTxDurationsMs.length) * 100) / 100
      : 0;
    return {
      typingAvgMs,
      idbWritesPerSecond: state.idbWriteTimestamps.length,
      networkRequestsPerSecond: state.networkRequestTimestamps.length,
      queueLength: state.queueLength,
      lastSyncAt: state.lastSyncAt,
      retryCount: state.retryCount,
      lastError: state.lastError,
      schemaWarnings: [...state.schemaWarnings],
      dbOpenAttempts: state.idbOpenAttempts,
      dbVersion: state.idbVersion,
      txCountPerSecond: state.idbTxTimestamps.length,
      avgTxTimeMs: avgIdbTxMs,
      lastIdbError: state.lastIdbError,
      idbEvents: [...state.idbEvents],
      lastNetworkRequest: state.lastNetworkRequest,
      activeRequest: state.activeRequest,
      lastErrorType: state.lastErrorType,
      nextRetryAt: state.nextRetryAt
    };
  }
};
