import React, { useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../logging';
import { SystemLogEntry } from '../types';
import { offlineDb } from '../storage/offlineDb';
import { getSyncDiagnosticsState } from '../syncDiagnostics';
import { syncPerf } from '../syncPerf';
import { FRONTEND_SCHEMA_VERSION } from '../schemaHealth';
import { LOCAL_ONLY, LOCAL_MODE_LABEL } from '../localMode';

const MAX_VISIBLE_LOGS = 400;
const INITIAL_RENDER_COUNT = 40;
const LOAD_MORE_STEP = 40;
const MAX_FIELD_CHARS = 2400;

const formatTime = (value: number) => new Date(value).toLocaleString();
const shortText = (value: string, max = MAX_FIELD_CHARS) => (value.length > max ? `${value.slice(0, max)}…` : value);
const maskPhone = (value: string) => value.replace(/\+?\d[\d\s-]{7,}/g, (match) => `${match.slice(0, 4)}***${match.slice(-4)}`);
const maskUrlSecrets = (value: string) => value.replace(/(token|apikey|api_key|access_token)=([^&\s]+)/gi, '$1=***').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
const maskSensitive = (value: string) => maskUrlSecrets(maskPhone(value));

const toPreviewMeta = (meta: unknown) => {
  if (meta === undefined) return '';
  if (typeof meta === 'string') return shortText(maskSensitive(meta));
  try {
    return shortText(maskSensitive(JSON.stringify(meta)));
  } catch {
    return shortText(maskSensitive(String(meta)));
  }
};

const buildDiagnosticsPayload = (logs: SystemLogEntry[], dbHealth: Record<string, { count: number; approxBytes: number }> | null, lastError: string) => {
  const syncState = getSyncDiagnosticsState();
  return JSON.stringify({
    appVersion: (import.meta as any).env?.VITE_APP_VERSION || 'dev',
    schemaVersion: FRONTEND_SCHEMA_VERSION,
    localOnly: LOCAL_ONLY,
    localModeLabel: LOCAL_MODE_LABEL,
    lastError,
    idbHealth: dbHealth,
    syncStatus: syncState.syncStatus,
    lastIndexedDbError: syncState.lastIndexedDbError,
    lastSupabaseError: syncState.lastSupabaseError,
    last50Logs: logs.slice(0, 50),
    capturedAt: new Date().toISOString()
  }, null, 2);
};

const DebugLogsScreen: React.FC = () => {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const [logs, setLogs] = useState<SystemLogEntry[]>(() => logger.getRecentBuffered(MAX_VISIBLE_LOGS));
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [tab, setTab] = useState<'overview' | 'raw'>('overview');
  const [diagnosticsLoaded, setDiagnosticsLoaded] = useState(false);
  const [dbHealth, setDbHealth] = useState<Record<string, { count: number; approxBytes: number }> | null>(null);
  const [perfSnapshot, setPerfSnapshot] = useState(syncPerf.snapshot());
  const [actionMs, setActionMs] = useState<number | null>(null);
  const [lastError, setLastError] = useState('none');

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const withDuration = async (fn: () => Promise<void>) => {
    const start = performance.now();
    try {
      await fn();
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setActionMs(Math.round(performance.now() - start));
    }
  };

  const loadStoredLogs = async () => {
    await withDuration(async () => {
      const next = await logger.getRecentStored(MAX_VISIBLE_LOGS);
      setLogs(next);
      setVisibleCount(INITIAL_RENDER_COUNT);
    });
  };

  const loadDiagnostics = async () => {
    await withDuration(async () => {
      const nextDbHealth = await offlineDb.getDiagnosticsSnapshot();
      setDbHealth(nextDbHealth);
      setPerfSnapshot(syncPerf.snapshot());
      setDiagnosticsLoaded(true);
    });
  };

  const onCopy = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(success);
    } catch {
      setCopyStatus('Clipboard failed');
    }
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  const exportDbSlow = async () => {
    await withDuration(async () => {
      const dump = await offlineDb.exportAllData();
      await onCopy(JSON.stringify(dump), 'DB export copied');
    });
  };

  const filteredLogs = useMemo(() => logs.filter((entry) => {
    if (severity !== 'all' && entry.level !== severity) return false;
    if (!debouncedQuery) return true;
    const haystack = `${entry.scope} ${entry.message} ${toPreviewMeta(entry.meta)}`.toLowerCase();
    return haystack.includes(debouncedQuery);
  }), [logs, severity, debouncedQuery]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, visibleCount), [filteredLogs, visibleCount]);

  const diagnosticsPayload = useMemo(
    () => buildDiagnosticsPayload(logs, dbHealth, lastError),
    [logs, dbHealth, lastError]
  );

  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-4 pb-24 space-y-3 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black">Debug / Logs</h1>
        <div className="text-[11px] text-gray-500">render#{renderCountRef.current}</div>
      </div>

      {copyStatus && <div className="text-[11px] font-bold text-emerald-600">{copyStatus}</div>}

      <div className="flex gap-2">
        {(['overview', 'raw'] as const).map((item) => (
          <button key={item} className={`px-3 py-2 rounded-xl text-xs font-black ${tab === item ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`} type="button" onClick={() => setTab(item)}>
            {item.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2 text-xs">
          <div className="rounded-xl border bg-white p-3 space-y-1">
            <p>Mode: <b>{LOCAL_MODE_LABEL}</b></p>
            <p>Schema: {FRONTEND_SCHEMA_VERSION}</p>
            <p>In-memory logs: {logs.length}</p>
            <p>Last action time: {actionMs === null ? 'n/a' : `${actionMs} ms`}</p>
          </div>

          {!diagnosticsLoaded && (
            <button className="rounded-lg bg-blue-600 text-white px-3 py-2 font-black" type="button" onClick={() => void loadDiagnostics()}>
              Load diagnostics
            </button>
          )}

          {diagnosticsLoaded && (
            <div className="rounded-xl border bg-white p-3 space-y-1">
              <p>Sync status: {getSyncDiagnosticsState().syncStatus}</p>
              <p>Queue length: {perfSnapshot.queueLength}</p>
              <p>IDB tx/sec: {perfSnapshot.txCountPerSecond}</p>
              <p>Last IDB error: {perfSnapshot.lastIdbError || 'none'}</p>
              {dbHealth && Object.entries(dbHealth).map(([name, stat]) => (
                <p key={name}>{name}: {stat.count} rows (~{(stat.approxBytes / 1024).toFixed(1)} KB)</p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-slate-900 text-white px-3 py-2 font-black" type="button" onClick={() => void onCopy(diagnosticsPayload, 'Diagnostics copied')}>
              Copy diagnostics
            </button>
            <button className="rounded-lg bg-amber-600 text-white px-3 py-2 font-black" type="button" onClick={() => void exportDbSlow()}>
              Export DB (slow)
            </button>
          </div>
        </div>
      )}

      {tab === 'raw' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search logs" className="rounded-lg border p-2 col-span-2" />
            <select value={severity} onChange={(e) => setSeverity(e.target.value as any)} className="rounded-lg border p-2">
              <option value="all">severity: all</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
            <div className="rounded-lg border p-2">showing {visibleLogs.length}/{filteredLogs.length}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-black" type="button" onClick={() => setLogs(logger.getRecentBuffered(MAX_VISIBLE_LOGS))}>
              Refresh buffered
            </button>
            <button className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black" type="button" onClick={() => void loadStoredLogs()}>
              Load recent stored logs
            </button>
            <button className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-black" type="button" onClick={async () => {
              await logger.clear();
              setLogs([]);
              setVisibleCount(INITIAL_RENDER_COUNT);
            }}>
              Clear logs
            </button>
          </div>

          <div className="space-y-2">
            {visibleLogs.map((entry) => {
              const isExpanded = Boolean(expandedRows[entry.id]);
              const safeMessage = shortText(maskSensitive(entry.message), isExpanded ? MAX_FIELD_CHARS : 180);
              const safeMeta = toPreviewMeta(entry.meta);

              return (
                <div key={entry.id} className="p-3 rounded-xl bg-white border border-gray-200">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-black uppercase text-gray-600">{entry.scope}</div>
                    <div className="text-[10px] text-gray-400">{formatTime(entry.createdAt)}</div>
                  </div>
                  <div className="text-xs font-bold mt-1 break-words">
                    <span className={`mr-2 ${entry.level === 'error' ? 'text-red-600' : entry.level === 'warn' ? 'text-amber-600' : 'text-blue-600'}`}>{entry.level.toUpperCase()}</span>
                    {safeMessage}
                  </div>
                  {safeMeta && (
                    <div className="mt-2 text-[10px] text-gray-600 whitespace-pre-wrap break-words">{isExpanded ? safeMeta : shortText(safeMeta, 180)}</div>
                  )}
                  {(entry.message.length > 180 || safeMeta.length > 180) && (
                    <button className="mt-2 underline text-[10px]" type="button" onClick={() => toggleExpanded(entry.id)}>
                      {isExpanded ? 'Collapse details' : 'Expand details'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {visibleCount < filteredLogs.length && (
            <button className="px-3 py-2 rounded-xl bg-gray-100 text-xs font-black" type="button" onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_STEP)}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DebugLogsScreen;
