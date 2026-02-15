import React, { useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../logging';
import { SystemLogEntry } from '../types';
import { DiagnosticsSummaryPayload, offlineDb } from '../storage/offlineDb';
import { syncPerf } from '../syncPerf';
import { LOCAL_ONLY, LOCAL_MODE_LABEL } from '../localMode';

const MAX_VISIBLE_LOGS = 400;
const INITIAL_RENDER_COUNT = 40;
const LOAD_MORE_STEP = 40;
const MAX_FIELD_CHARS = 2400;
const MAX_DIAGNOSTICS_BYTES = 200 * 1024;
const EXPORT_HARD_CAP_BYTES = 25 * 1024 * 1024;

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

const toDiagnosticsPayload = (
  summary: DiagnosticsSummaryPayload | null,
  logs: SystemLogEntry[],
  lastError: string,
  timings: { durationMs: number; batches: number }
) => {
  const basePayload = {
    appVersion: (import.meta as any).env?.VITE_APP_VERSION || 'dev',
    schemaVersion: 'local-only',
    localOnly: LOCAL_ONLY,
    localModeLabel: LOCAL_MODE_LABEL,
    lastError,
    idbSchemaVersion: summary?.schemaVersion || 'unknown',
    idbStores: summary?.stores || {},
    counts: summary?.entityCounts || { orders: 0, parts: 0, price_variants: 0, shops: 0, app_state_keys: 0 },
    syncStatus: 'local-only',
    lastIndexedDbError: null,
    lastSupabaseError: null,
    lastLogs: summary?.lastLogs || logs.slice(0, 50),
    lastErrors: summary?.lastErrors || logs.filter((entry) => entry.level === 'error').slice(0, 20),
    perf: timings,
    capturedAt: new Date().toISOString()
  };

  let json = JSON.stringify(basePayload, null, 2);
  if (new Blob([json]).size <= MAX_DIAGNOSTICS_BYTES) return json;

  const reduced = {
    ...basePayload,
    lastLogs: basePayload.lastLogs.slice(0, 20),
    lastErrors: basePayload.lastErrors.slice(0, 10),
    diagnosticsNote: 'Payload trimmed to stay under iOS-safe diagnostics size limit.'
  };
  json = JSON.stringify(reduced, null, 2);
  return json;
};

const DebugLogsScreen: React.FC = () => {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const diagnosticsAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [logs, setLogs] = useState<SystemLogEntry[]>(() => logger.getRecentBuffered(MAX_VISIBLE_LOGS));
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [tab, setTab] = useState<'overview' | 'raw'>('overview');
  const [diagnosticsLoaded, setDiagnosticsLoaded] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<DiagnosticsSummaryPayload | null>(null);
  const [diagnosticsBatches, setDiagnosticsBatches] = useState(0);
  const [diagnosticsDurationMs, setDiagnosticsDurationMs] = useState(0);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string>('idle');
  const [perfSnapshot, setPerfSnapshot] = useState(syncPerf.snapshot());
  const [actionMs, setActionMs] = useState<number | null>(null);
  const [lastError, setLastError] = useState('none');
  const [exportingDb, setExportingDb] = useState(false);
  const [exportProgress, setExportProgress] = useState<string>('idle');

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => () => {
    diagnosticsAbortRef.current?.abort();
    exportAbortRef.current?.abort();
  }, []);

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
    diagnosticsAbortRef.current?.abort();
    const controller = new AbortController();
    diagnosticsAbortRef.current = controller;
    setDiagnosticsLoading(true);
    setDiagnosticsStatus('loading');
    setDiagnosticsBatches(0);

    await withDuration(async () => {
      const startedAt = performance.now();
      try {
        const summary = await offlineDb.getDiagnosticsSummary({
          signal: controller.signal,
          sampleLimit: 50,
          onBatch: async () => {
            setDiagnosticsBatches((prev) => prev + 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
        });
        setDiagnosticsSummary(summary);
        setPerfSnapshot(syncPerf.snapshot());
        setDiagnosticsLoaded(true);
        setDiagnosticsStatus('ready');
      } catch (error) {
        const fallbackLogs = logs.slice(0, 50);
        const fallbackSummary: DiagnosticsSummaryPayload = {
          schemaVersion: 'local-only',
          stores: { fallback: { count: fallbackLogs.length, approxBytes: new Blob([JSON.stringify(fallbackLogs)]).size } },
          entityCounts: { orders: 0, parts: 0, price_variants: 0, shops: 0, app_state_keys: 0 },
          lastLogs: fallbackLogs,
          lastErrors: fallbackLogs.filter((entry) => entry.level === 'error').slice(0, 20)
        };
        setDiagnosticsSummary(fallbackSummary);
        setDiagnosticsLoaded(true);
        setDiagnosticsStatus(error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'fallback');
      } finally {
        setDiagnosticsDurationMs(Math.round(performance.now() - startedAt));
      }
    }).finally(() => {
      setDiagnosticsLoading(false);
      diagnosticsAbortRef.current = null;
    });
  };

  const cancelDiagnostics = () => {
    diagnosticsAbortRef.current?.abort();
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
    if (!window.confirm('Export is slow and may create a large file. Continue?')) return;

    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportingDb(true);
    setExportProgress('starting');

    await withDuration(async () => {
      let bytes = 0;
      let firstStore = true;
      const rowCountByStore = new Map<string, number>();
      const blobParts: BlobPart[] = ['{'];

      const append = (piece: string) => {
        bytes += new Blob([piece]).size;
        if (bytes > EXPORT_HARD_CAP_BYTES) {
          throw new Error('Export exceeded safe size cap (25 MB).');
        }
        blobParts.push(piece);
      };

      await offlineDb.exportAllDataChunked({
        signal: controller.signal,
        batchSize: 100,
        onStoreChunk: async ({ store, rows, isLastChunk }) => {
          if (!rowCountByStore.has(store)) {
            append(`${firstStore ? '' : ','}\n"${store}":[`);
            firstStore = false;
            rowCountByStore.set(store, 0);
          }
          let rowCount = rowCountByStore.get(store) || 0;
          for (const row of rows) {
            const serialized = JSON.stringify(row);
            append(`${rowCount > 0 ? ',' : ''}${serialized}`);
            rowCount += 1;
          }
          rowCountByStore.set(store, rowCount);
          if (isLastChunk) append(']');
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        },
        onStoreProgress: async ({ store, processed, total, elapsedMs }) => {
          setExportProgress(`${store}: ${processed}/${total} rows (${elapsedMs} ms)`);
        }
      });

      append('\n}');
      const blob = new Blob(blobParts, { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `offline-db-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setExportProgress(`done (${Math.round(blob.size / 1024)} KB)`);
    }).finally(() => {
      setExportingDb(false);
      exportAbortRef.current = null;
    });
  };

  const cancelExport = () => {
    exportAbortRef.current?.abort();
    setExportProgress('cancelled');
  };

  const filteredLogs = useMemo(() => logs.filter((entry) => {
    if (severity !== 'all' && entry.level !== severity) return false;
    if (!debouncedQuery) return true;
    const haystack = `${entry.scope} ${entry.message} ${toPreviewMeta(entry.meta)}`.toLowerCase();
    return haystack.includes(debouncedQuery);
  }), [logs, severity, debouncedQuery]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, visibleCount), [filteredLogs, visibleCount]);

  const diagnosticsPayload = useMemo(
    () => toDiagnosticsPayload(diagnosticsSummary, logs, lastError, { durationMs: diagnosticsDurationMs, batches: diagnosticsBatches }),
    [diagnosticsSummary, logs, lastError, diagnosticsDurationMs, diagnosticsBatches]
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
            <p>Schema: local-only</p>
            <p>In-memory logs: {logs.length}</p>
            <p>Last action time: {actionMs === null ? 'n/a' : `${actionMs} ms`}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-blue-600 text-white px-3 py-2 font-black" type="button" onClick={() => void loadDiagnostics()} disabled={diagnosticsLoading}>
              {diagnosticsLoading ? 'Loading diagnostics…' : 'Load diagnostics'}
            </button>
            {diagnosticsLoading && (
              <button className="rounded-lg bg-gray-200 text-gray-800 px-3 py-2 font-black" type="button" onClick={cancelDiagnostics}>
                Cancel
              </button>
            )}
          </div>

          {diagnosticsLoaded && diagnosticsSummary && (
            <div className="rounded-xl border bg-white p-3 space-y-1">
              <p>Status: {diagnosticsStatus}</p>
              <p>Timing: {diagnosticsDurationMs} ms ({diagnosticsBatches} batches)</p>
              <p>Sync status: local-only</p>
              <p>Queue length: {perfSnapshot.queueLength}</p>
              <p>IDB tx/sec: {perfSnapshot.txCountPerSecond}</p>
              <p>Last IDB error: {perfSnapshot.lastIdbError || 'none'}</p>
              <p>orders: {diagnosticsSummary.entityCounts.orders}</p>
              <p>parts(sampled): {diagnosticsSummary.entityCounts.parts}</p>
              <p>price_variants(sampled): {diagnosticsSummary.entityCounts.price_variants}</p>
              <p>shops: {diagnosticsSummary.entityCounts.shops}</p>
              <p>app_state keys: {diagnosticsSummary.entityCounts.app_state_keys}</p>
              {Object.entries(diagnosticsSummary.stores).map(([name, stat]) => (
                <p key={name}>{name}: {stat.count} rows (~{(stat.approxBytes / 1024).toFixed(1)} KB sample)</p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-slate-900 text-white px-3 py-2 font-black" type="button" onClick={() => void onCopy(diagnosticsPayload, 'Diagnostics copied')}>
              Copy diagnostics
            </button>
            <button className="rounded-lg bg-amber-600 text-white px-3 py-2 font-black" type="button" onClick={() => void exportDbSlow()} disabled={exportingDb}>
              {exportingDb ? 'Exporting…' : 'Export DB (slow)'}
            </button>
            {exportingDb && (
              <button className="rounded-lg bg-gray-200 text-gray-800 px-3 py-2 font-black" type="button" onClick={cancelExport}>
                Cancel export
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-500">{exportProgress}</p>
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
