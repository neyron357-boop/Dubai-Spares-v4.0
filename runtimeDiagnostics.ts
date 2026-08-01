import { logger } from './logging';

let installed = false;

const serializeUnhandledError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
};

export const installRuntimeDiagnostics = () => {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    void logger.error('ui:window', 'window_error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: serializeUnhandledError(event.error)
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void logger.error('ui:window', 'unhandled_promise_rejection', {
      reason: serializeUnhandledError(event.reason)
    });
  });

  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.entryType === 'longtask') {
            void logger.warn('ui:performance', 'Long task detected', {
              durationMs: Math.round(entry.duration),
              name: entry.name,
              startTime: Math.round(entry.startTime)
            });
          }
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // ignore unsupported longtask observer variants
    }
  }
};
