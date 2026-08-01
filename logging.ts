import { offlineDb } from './storage/offlineDb';
import type { SystemLogEntry, SystemLogLevel } from './types';

const MAX_LOGS = 500;
const MAX_ABSOLUTE_LOGS = 3000;
const MAX_BUFFERED_LOGS = 300;
const MAX_BUFFERED_ABSOLUTE_LOGS = 900;

const LOG_LEVEL: SystemLogLevel = 'warn';
const LOG_LEVEL_WEIGHT: Record<SystemLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const shouldLogLevel = (level: SystemLogLevel) => LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[LOG_LEVEL];

const readSessionId = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem('app_session_id') : null;
  } catch {
    return null;
  }
};

const persistSessionId = (value: string) => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem('app_session_id', value);
  } catch {
    // localStorage can be unavailable in test and restricted browser contexts.
  }
};

const sessionId = readSessionId() || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
persistSessionId(sessionId);

const memoryLogBuffer: SystemLogEntry[] = [];
const absoluteMemoryLogBuffer: SystemLogEntry[] = [];

type NativeConsole = Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;
const nativeConsole: NativeConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

let isInternalConsoleWrite = false;
let browserHooksInstalled = false;

const getCategory = (scope: string, level: SystemLogLevel): SystemLogEntry['category'] => {
  if (scope.startsWith('sync')) return 'sync';
  if (scope.startsWith('ui')) return 'ui';
  if (scope.startsWith('network') || scope.includes('fetch') || scope.includes('quote')) return 'network';
  if (level === 'error') return 'errors';
  if (level === 'warn') return 'warn';
  return 'info';
};

const parseMetaForContext = (meta?: unknown) => {
  if (!meta || typeof meta !== 'object') {
    return { requestId: undefined, orderId: undefined };
  }

  const source = meta as Record<string, unknown>;
  return {
    requestId: typeof source.requestId === 'string' ? source.requestId : undefined,
    orderId: typeof source.orderId === 'string' ? source.orderId : undefined
  };
};

const createLogEntry = (
  level: SystemLogLevel,
  scope: string,
  message: string,
  meta?: unknown,
  options?: { mode?: 'regular' | 'absolute'; source?: SystemLogEntry['source'] }
): SystemLogEntry => {
  const context = parseMetaForContext(meta);
  return {
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
    requestId: context.requestId,
    orderId: context.orderId,
    mode: options?.mode || 'regular',
    source: options?.source || 'app'
  };
};

const pushMemoryLog = (entry: SystemLogEntry) => {
  if (entry.mode === 'absolute') {
    absoluteMemoryLogBuffer.push(entry);
    if (absoluteMemoryLogBuffer.length > MAX_BUFFERED_ABSOLUTE_LOGS) {
      absoluteMemoryLogBuffer.splice(0, absoluteMemoryLogBuffer.length - MAX_BUFFERED_ABSOLUTE_LOGS);
    }
    return;
  }

  memoryLogBuffer.push(entry);
  if (memoryLogBuffer.length > MAX_BUFFERED_LOGS) {
    memoryLogBuffer.splice(0, memoryLogBuffer.length - MAX_BUFFERED_LOGS);
  }
};

const writeToOfflineStorage = async (entry: SystemLogEntry, maxLogs: number) => {
  await offlineDb.addSystemLog(entry, maxLogs);
};

const emit = async (
  level: SystemLogLevel,
  scope: string,
  message: string,
  meta?: unknown,
  options?: { mode?: 'regular' | 'absolute'; source?: SystemLogEntry['source']; silentConsole?: boolean }
) => {
  if (!shouldLogLevel(level)) return;

  const mode = options?.mode || 'regular';
  const entry = createLogEntry(level, scope, message, meta, { mode, source: options?.source });
  pushMemoryLog(entry);

  if (!options?.silentConsole) {
    isInternalConsoleWrite = true;
    try {
      if (level === 'error') {
        nativeConsole.error(`[${scope}] ${message}`, meta ?? '');
      } else if (level === 'warn') {
        nativeConsole.warn(`[${scope}] ${message}`, meta ?? '');
      } else if (level === 'debug') {
        nativeConsole.debug(`[${scope}] ${message}`, meta ?? '');
      } else {
        nativeConsole.log(`[${scope}] ${message}`, meta ?? '');
      }
    } finally {
      isInternalConsoleWrite = false;
    }
  }

  try {
    await writeToOfflineStorage(entry, mode === 'absolute' ? MAX_ABSOLUTE_LOGS : MAX_LOGS);

    if (mode === 'regular') {
      const storageMeta = {
        linkedLogId: entry.id,
        operation: 'write_system_log',
        indexedDb: 'dubai-spares-offline/system_logs',
        persistedLocallyOnly: true,
        retainedEntries: MAX_LOGS,
        source: options?.source || 'app'
      };
      const absoluteEntry = createLogEntry('debug', 'absolute:persist', `Log stored locally in IndexedDB (${scope})`, storageMeta, {
        mode: 'absolute',
        source: options?.source || 'app'
      });
      pushMemoryLog(absoluteEntry);
      await writeToOfflineStorage(absoluteEntry, MAX_ABSOLUTE_LOGS);
    }

    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('system-log-updated', { detail: { count: await offlineDb.getSystemLogCount() } }));
    }
  } catch (error) {
    nativeConsole.error('Failed to write system log', error);
  }
};

const formatConsoleArgs = (args: unknown[]) => {
  if (!args.length) return '';
  return args.map((part) => {
    if (typeof part === 'string') return part;
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }).join(' ');
};

const installBrowserHooks = () => {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  if (browserHooksInstalled) return;
  browserHooksInstalled = true;

  const bindConsoleProxy = (method: keyof NativeConsole, level: SystemLogLevel) => {
    const original = nativeConsole[method];
    console[method] = (...args: unknown[]) => {
      if (!shouldLogLevel(level)) return;
      original(...args as Parameters<typeof original>);
      if (isInternalConsoleWrite) return;
      void emit(level, 'browser:console', formatConsoleArgs(args) || '[empty console call]', { args }, {
        mode: 'absolute',
        source: 'browser-console',
        silentConsole: true
      });
    };
  };

  bindConsoleProxy('log', 'info');
  bindConsoleProxy('info', 'info');
  bindConsoleProxy('warn', 'warn');
  bindConsoleProxy('error', 'error');
  bindConsoleProxy('debug', 'debug');

  window.addEventListener('error', (event) => {
    void emit('error', 'browser:runtime', event.message || 'Unhandled window error', {
      filename: event.filename,
      line: event.lineno,
      column: event.colno
    }, {
      mode: 'absolute',
      source: 'browser-runtime',
      silentConsole: true
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : event.reason;

    void emit('error', 'browser:runtime', 'Unhandled promise rejection', { reason }, {
      mode: 'absolute',
      source: 'browser-runtime',
      silentConsole: true
    });
  });

  void emit('warn', 'logging:setup', 'Browser console/runtime hooks installed', {
    localOnly: true,
    indexedDb: 'dubai-spares-offline/system_logs'
  }, {
    mode: 'absolute',
    source: 'app',
    silentConsole: true
  });
};

installBrowserHooks();

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => emit('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
  absolute: (level: SystemLogLevel, scope: string, message: string, meta?: unknown, source: SystemLogEntry['source'] = 'app') => emit(level, scope, message, meta, { mode: 'absolute', source }),
  captureServerEvent: (message: string, meta?: unknown) => emit('warn', 'server:event', message, meta, { mode: 'absolute', source: 'server-event' }),
  getRecent: (limit = 100) => offlineDb.getSystemLogs(limit),
  getRecentStored: (limit = 100) => offlineDb.getSystemLogs(limit),
  getRecentBuffered: (limit = MAX_BUFFERED_LOGS) => memoryLogBuffer.slice(-limit).reverse(),
  getRecentAbsoluteBuffered: (limit = MAX_BUFFERED_ABSOLUTE_LOGS) => absoluteMemoryLogBuffer.slice(-limit).reverse(),
  clear: async () => {
    memoryLogBuffer.length = 0;
    absoluteMemoryLogBuffer.length = 0;
    await offlineDb.clearSystemLogs();
    window.dispatchEvent(new CustomEvent('system-log-updated', { detail: { count: 0 } }));
  }
};
