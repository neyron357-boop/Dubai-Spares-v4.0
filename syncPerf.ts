import { logger } from './logging';

export type SyncLogCategory = 'MUTATION_QUEUE' | 'IDB_TX';

type PerfState = {
  typingSamplesMs: number[];
  idbWriteTimestamps: number[];
  idbOpenAttempts: number;
  idbVersion: number | null;
  idbTxTimestamps: number[];
  idbTxDurationsMs: number[];
  lastIdbError: string | null;
  idbEvents: Array<{ at: number; event: string; meta?: unknown }>;
};

const state: PerfState = {
  typingSamplesMs: [],
  idbWriteTimestamps: [],
  idbOpenAttempts: 0,
  idbVersion: null,
  idbTxTimestamps: [],
  idbTxDurationsMs: [],
  lastIdbError: null,
  idbEvents: [],
};

const oneSecondAgo = () => Date.now() - 1000;

const trimOld = (arr: number[]) => {
  const border = oneSecondAgo();
  while (arr.length && arr[0] < border) arr.shift();
};

const sampledSignatures = new Map<string, number>();

export const logSyncCategory = (
  category: SyncLogCategory,
  message: string,
  meta?: unknown,
  dedupeMs = 4000,
) => {
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
    const typingAvgMs = state.typingSamplesMs.length
      ? Math.round(
          (state.typingSamplesMs.reduce((sum, value) => sum + value, 0) /
            state.typingSamplesMs.length) *
            100,
        ) / 100
      : 0;
    const avgIdbTxMs = state.idbTxDurationsMs.length
      ? Math.round(
          (state.idbTxDurationsMs.reduce((sum, value) => sum + value, 0) /
            state.idbTxDurationsMs.length) *
            100,
        ) / 100
      : 0;
    return {
      typingAvgMs,
      idbWritesPerSecond: state.idbWriteTimestamps.length,
      dbOpenAttempts: state.idbOpenAttempts,
      dbVersion: state.idbVersion,
      txCountPerSecond: state.idbTxTimestamps.length,
      avgTxTimeMs: avgIdbTxMs,
      lastIdbError: state.lastIdbError,
      idbEvents: [...state.idbEvents],
    };
  },
};
