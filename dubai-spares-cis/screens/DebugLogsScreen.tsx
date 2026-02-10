import React, { useEffect, useMemo, useState } from 'react';
import { logger } from '../logging';
import { SystemLogEntry } from '../types';

const formatTime = (value: number) => new Date(value).toLocaleString();

const stringifyMeta = (meta: unknown) => {
  if (meta === undefined) return '';
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
};

const DebugLogsScreen: React.FC = () => {
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [showOnlyImportant, setShowOnlyImportant] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const IMPORTANT_LIMIT = 60;
  const FULL_LIMIT = 180;

  const isImportant = (entry: SystemLogEntry) => {
    if (entry.level === 'error' || entry.level === 'warn') return true;
    const scope = entry.scope.toLowerCase();
    const message = entry.message.toLowerCase();
    return scope.includes('sync') || scope.includes('radar') || scope.includes('order') || message.includes('failed') || message.includes('error');
  };

  const loadLogs = async () => {
    setLoading(true);
    const next = await logger.getRecent(FULL_LIMIT);
    setLogs(next);
    setLoading(false);
  };

  useEffect(() => {
    void loadLogs();

    const onLogUpdate = () => {
      void loadLogs();
    };

    window.addEventListener('system-log-updated', onLogUpdate);
    return () => window.removeEventListener('system-log-updated', onLogUpdate);
  }, []);

  const importantLogs = useMemo(() => logs.filter(isImportant), [logs]);

  const displayLogs = useMemo(() => {
    const base = showOnlyImportant ? importantLogs : logs;
    if (showAll) return base;
    return base.slice(0, IMPORTANT_LIMIT);
  }, [importantLogs, logs, showOnlyImportant, showAll]);

  const exportText = useMemo(
    () =>
      displayLogs
        .map((entry) => {
          const meta = stringifyMeta(entry.meta);
          return `${formatTime(entry.createdAt)} [${entry.level.toUpperCase()}] ${entry.scope}: ${entry.message}${meta ? `\n${meta}` : ''}`;
        })
        .join('\n\n'),
    [displayLogs]
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText || 'No logs available');
      setCopyStatus('Logs copied');
    } catch {
      setCopyStatus('Clipboard failed');
    }

    setTimeout(() => setCopyStatus(null), 1600);
  };

  return (
    <div className="p-4 pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black">Debug / Logs</h1>
        <div className="text-[11px] text-gray-500">{displayLogs.length}/{showOnlyImportant ? importantLogs.length : logs.length} entries</div>
      </div>

      <div className="flex gap-2">
        <button className={`px-3 py-2 rounded-xl text-xs font-black ${showOnlyImportant ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`} type="button" onClick={() => { setShowOnlyImportant((current) => !current); setShowAll(false); }}>
          {showOnlyImportant ? 'Важные' : 'Все'}
        </button>
        <button className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-black" type="button" onClick={() => void loadLogs()}>
          Refresh
        </button>
        <button className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black" type="button" onClick={onCopy}>
          Copy Logs to Clipboard
        </button>
        <button
          className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-black"
          type="button"
          onClick={async () => {
            await logger.clear();
            await loadLogs();
          }}
        >
          Clear
        </button>
      </div>

      {copyStatus && <div className="text-[11px] font-bold text-emerald-600">{copyStatus}</div>}

      <div className="space-y-2">
        {loading ? (
          <div className="text-xs text-gray-500">Loading logs…</div>
        ) : displayLogs.length === 0 ? (
          <div className="text-xs text-gray-500">No logs yet.</div>
        ) : (
          displayLogs.map((entry) => (
            <div key={entry.id} className="p-3 rounded-xl bg-white border border-gray-200">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase text-gray-600">{entry.scope}</div>
                <div className="text-[10px] text-gray-400">{formatTime(entry.createdAt)}</div>
              </div>
              <div className="text-xs font-bold mt-1">
                <span
                  className={`mr-2 ${
                    entry.level === 'error' ? 'text-red-600' : entry.level === 'warn' ? 'text-amber-600' : 'text-blue-600'
                  }`}
                >
                  {entry.level.toUpperCase()}
                </span>
                {entry.message}
              </div>
              {entry.meta !== undefined && (
                <pre className="mt-2 text-[10px] text-gray-600 whitespace-pre-wrap break-words">{stringifyMeta(entry.meta)}</pre>
              )}
            </div>
          ))
        )}
        {!loading && !showAll && ((showOnlyImportant ? importantLogs.length : logs.length) > IMPORTANT_LIMIT) && (
          <button
            className="w-full rounded-xl border border-gray-200 bg-white py-2 text-[11px] font-black uppercase text-gray-600"
            type="button"
            onClick={() => setShowAll(true)}
          >
            Показать больше
          </button>
        )}
      </div>
    </div>
  );
};

export default DebugLogsScreen;
