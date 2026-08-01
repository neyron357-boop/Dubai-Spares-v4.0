import { createUuid } from './id';
import { applyRadarEventAtomic, RadarApplyEventPayload } from './radarSessionService';

export type SyncQueueStatus = 'pending' | 'sent' | 'failed';

export interface SyncQueueItem {
  id: string;
  type: 'radar_event';
  payload: RadarApplyEventPayload;
  attempts: number;
  created_at: number;
  last_attempt_at?: number;
  next_attempt_at?: number;
  status: SyncQueueStatus;
  error?: string;
}

const SYNC_QUEUE_KEY = 'radar_sync_queue_v1';
const BATCH_LIMIT = 20;
const RETRY_BACKOFF = [5000, 15000, 60000, 300000] as const;
let flushTimer: number | null = null;
let flushInFlight: Promise<void> | null = null;

const readQueue = (): SyncQueueItem[] => {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeQueue = (items: SyncQueueItem[]) => {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(items.slice(-1000)));
};

const nextBackoffMs = (attempts: number) => RETRY_BACKOFF[Math.min(attempts, RETRY_BACKOFF.length - 1)];

const scheduleFlush = () => {
  if (flushTimer) window.clearTimeout(flushTimer);
  const queue = readQueue().filter((item) => item.status !== 'sent');
  if (!queue.length) return;
  const now = Date.now();
  const nearest = Math.min(...queue.map((item) => item.next_attempt_at || now));
  const delay = Math.max(0, nearest - now);
  flushTimer = window.setTimeout(() => {
    void flushRadarSyncQueue();
  }, delay);
};

export const enqueueRadarSyncEvent = async (payload: RadarApplyEventPayload) => {
  const queue = readQueue();
  queue.push({
    id: payload.client_event_id || createUuid(),
    type: 'radar_event',
    payload,
    attempts: 0,
    created_at: Date.now(),
    status: 'pending'
  });
  writeQueue(queue);
  await flushRadarSyncQueue();
};

export const flushRadarSyncQueue = async () => {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    if (!navigator.onLine) return;
    const queue = readQueue();
    const now = Date.now();
    const pending = queue
      .filter((item) => item.status !== 'sent' && (item.next_attempt_at || 0) <= now)
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, BATCH_LIMIT);

    if (!pending.length) {
      scheduleFlush();
      return;
    }

    for (const item of pending) {
      const idx = queue.findIndex((row) => row.id === item.id);
      if (idx === -1) continue;
      queue[idx] = { ...queue[idx], last_attempt_at: Date.now() };
      try {
        await applyRadarEventAtomic(item.payload);
        queue[idx] = { ...queue[idx], status: 'sent', error: undefined };
      } catch (error) {
        const attempts = (queue[idx].attempts || 0) + 1;
        const delay = nextBackoffMs(attempts - 1);
        queue[idx] = {
          ...queue[idx],
          attempts,
          status: 'failed',
          next_attempt_at: Date.now() + delay,
          error: error instanceof Error ? error.message : 'sync_failed'
        };
      }
    }

    writeQueue(queue);
    scheduleFlush();
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
};

export const getRadarSyncQueueStats = () => {
  const queue = readQueue();
  return {
    pending: queue.filter((item) => item.status !== 'sent').length,
    failed: queue.filter((item) => item.status === 'failed').length
  };
};

export const startRadarSyncQueue = () => {
  window.addEventListener('online', () => { void flushRadarSyncQueue(); });
  window.addEventListener('focus', () => { void flushRadarSyncQueue(); });
  void flushRadarSyncQueue();
};
