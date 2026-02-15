import { offlineDb } from './storage/offlineDb';
import type { SystemLogEntry, SystemLogLevel } from './types';

const MAX_LOGS = 500;
const MAX_BUFFERED_LOGS = 300;

const sessionId = window.localStorage.getItem('app_session_id') || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
window.localStorage.setItem('app_session_id', sessionId);

const memoryLogBuffer: SystemLogEntry[] = [];

const getCategory = (scope: string, level: SystemLogLevel): SystemLogEntry['category'] => {
  if (scope.startsWith('sync')) return 'sync';
  if (scope.startsWith('ui')) return 'ui';
  if (scope.startsWith('network') || scope.includes('fetch') || scope.includes('quote')) return 'network';
  if (level === 'error') return 'errors';
  if (level === 'warn') return 'warn';
  return 'info';
};

const createLogEntry = (level: SystemLogLevel, scope: string, message: string, meta?: unknown): SystemLogEntry => ({
  id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  level,
  scope,
  message,
  meta,
  createdAt: Date.now(),
  category: getCategory(scope, level),
  sessionId,
  requestId: (meta as any)?.requestId,
  orderId: (meta as any)?.orderId
});

const pushMemoryLog = (entry: SystemLogEntry) => {
  memoryLogBuffer.push(entry);
  if (memoryLogBuffer.length > MAX_BUFFERED_LOGS) {
    memoryLogBuffer.splice(0, memoryLogBuffer.length - MAX_BUFFERED_LOGS);
  }
};

const emit = async (level: SystemLogLevel, scope: string, message: string, meta?: unknown) => {
  const entry = createLogEntry(level, scope, message, meta);
  pushMemoryLog(entry);

  if (level === 'error') {
    console.error(`[${scope}] ${message}`, meta ?? '');
  } else if (level === 'warn') {
    console.warn(`[${scope}] ${message}`, meta ?? '');
  } else if (level === 'debug') {
    console.debug(`[${scope}] ${message}`, meta ?? '');
  } else {
    console.log(`[${scope}] ${message}`, meta ?? '');
  }

  try {
    await offlineDb.addSystemLog(entry, MAX_LOGS);
    window.dispatchEvent(new CustomEvent('system-log-updated', { detail: { count: await offlineDb.getSystemLogCount() } }));
  } catch (error) {
    console.error('Failed to write system log', error);
  }
};

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => emit('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
  getRecent: (limit = 100) => offlineDb.getSystemLogs(limit),
  getRecentStored: (limit = 100) => offlineDb.getSystemLogs(limit),
  getRecentBuffered: (limit = MAX_BUFFERED_LOGS) => memoryLogBuffer.slice(-limit).reverse(),
  clear: async () => {
    memoryLogBuffer.length = 0;
    await offlineDb.clearSystemLogs();
  }
};
