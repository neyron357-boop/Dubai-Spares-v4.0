import type { SystemLogEntry, SystemLogLevel } from './types';

/** Local diagnostics: no global console interception and no writes during module initialization. */
const emit = async (level: SystemLogLevel, scope: string, message: string, meta?: unknown) => {
  if (level === 'debug' || level === 'info') return;
  const entry: SystemLogEntry = {
    id: crypto.randomUUID(),
    level,
    scope,
    message,
    meta,
    createdAt: Date.now(),
    category: level === 'error' ? 'errors' : 'warn',
    source: 'app',
  };
  console[level === 'error' ? 'error' : 'warn'](`[${scope}] ${message}`, meta ?? '');
  try {
    const { offlineDb } = await import('./storage/offlineDb');
    await offlineDb.addSystemLog(entry, 500);
  } catch {
    /* Storage failure must not recursively trigger more log writes. */
  }
};
export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => emit('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
};
