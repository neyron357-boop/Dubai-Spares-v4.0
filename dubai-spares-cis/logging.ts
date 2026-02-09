import { offlineDb } from './storage/offlineDb';
import type { SystemLogEntry, SystemLogLevel } from './types';

const MAX_LOGS = 200;

const createLogEntry = (level: SystemLogLevel, scope: string, message: string, meta?: unknown): SystemLogEntry => ({
  id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  level,
  scope,
  message,
  meta,
  createdAt: Date.now()
});

const emit = async (level: SystemLogLevel, scope: string, message: string, meta?: unknown) => {
  const entry = createLogEntry(level, scope, message, meta);

  if (level === 'error') {
    console.error(`[${scope}] ${message}`, meta ?? '');
  } else if (level === 'warn') {
    console.warn(`[${scope}] ${message}`, meta ?? '');
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
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
  getRecent: (limit = 100) => offlineDb.getSystemLogs(limit),
  clear: () => offlineDb.clearSystemLogs()
};
