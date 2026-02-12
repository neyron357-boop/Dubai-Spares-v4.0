import React, { useEffect, useMemo, useState } from 'react';
import { logger } from '../logging';
import { SystemLogEntry } from '../types';
import { offlineDb } from '../storage/offlineDb';
import { loadAppSettings } from '../appSettings';
import { checkSchemaHealth, FRONTEND_SCHEMA_VERSION } from '../schemaHealth';
import { supabase } from '../supabase';

const formatTime = (value: number) => new Date(value).toLocaleString();
const maskPhone = (value: string) => value.replace(/\+?\d[\d\s-]{7,}/g, (match) => `${match.slice(0, 4)}***${match.slice(-4)}`);
const maskUrlSecrets = (value: string) => value.replace(/(token|apikey|api_key|access_token)=([^&\s]+)/gi, '$1=***').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
const maskSensitive = (value: string) => maskUrlSecrets(maskPhone(value));

const stringifyMeta = (meta: unknown) => {
  if (meta === undefined) return '';
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
};

const groupedLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const oneDay = 24 * 60 * 60 * 1000;
  const diff = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (diff === 0) return 'Сегодня';
  if (diff === oneDay) return 'Вчера';
  return 'Ранее';
};

const DebugLogsScreen: React.FC = () => {
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'diagnostic' | 'raw'>('overview');
  const [severity, setSeverity] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [scope, setScope] = useState<'all' | 'database' | 'sync' | 'supabase' | 'radar' | 'ui'>('all');
  const [query, setQuery] = useState('');
  const [maskVin, setMaskVin] = useState(false);
  const [schemaState, setSchemaState] = useState<{ ok: boolean; reason?: string }>({ ok: true });
  const [dbStats, setDbStats] = useState<Record<string, { count: number; approxBytes: number }>>({});
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number; time: number } | null>(null);
  const [showExactGps, setShowExactGps] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    const next = await logger.getRecent(2000);
    setLogs(next);
    setLoading(false);
  };

  useEffect(() => {
    void loadLogs();
    void offlineDb.getDiagnosticsSnapshot().then(setDbStats);
    void checkSchemaHealth().then((r) => setSchemaState({ ok: r.compatible, reason: r.reason }));

    const onLogUpdate = () => {
      void loadLogs();
    };

    window.addEventListener('system-log-updated', onLogUpdate);
    return () => window.removeEventListener('system-log-updated', onLogUpdate);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, time: pos.timestamp });
    });
  }, []);

  const filteredLogs = useMemo(() => logs.filter((entry) => {
    if (severity !== 'all' && entry.level !== severity) return false;
    if (scope !== 'all' && !entry.scope.toLowerCase().includes(scope)) return false;
    if (!query.trim()) return true;
    const hay = `${entry.message} ${entry.scope} ${stringifyMeta(entry.meta)}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  }), [logs, severity, scope, query]);

  const overview = useMemo(() => {
    const lastError = logs.find((entry) => entry.level === 'error');
    const queueSize = dbStats.mutations?.count ?? 0;
    const supabaseReachable = !logs.some((entry) => entry.scope.includes('supabase:response') && entry.level === 'error');
    return {
      databaseOk: schemaState.ok,
      supabaseReachable,
      authOk: supabaseReachable,
      queueSize,
      lastError
    };
  }, [logs, dbStats, schemaState]);

  const renderLog = (entry: SystemLogEntry) => {
    let meta = stringifyMeta(entry.meta);
    if (maskVin) meta = meta.replace(/[A-HJ-NPR-Z0-9]{17}/g, '***VIN***');
    const safeMessage = maskSensitive(entry.message);
    const safeMeta = maskSensitive(meta);

    return (
      <div key={entry.id} className="p-3 rounded-xl bg-white border border-gray-200">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase text-gray-600">{entry.scope}</div>
          <div className="text-[10px] text-gray-400">{formatTime(entry.createdAt)}</div>
        </div>
        <div className="text-xs font-bold mt-1"><span className={`mr-2 ${entry.level === 'error' ? 'text-red-600' : entry.level === 'warn' ? 'text-amber-600' : 'text-blue-600'}`}>{entry.level.toUpperCase()}</span>{safeMessage}</div>
        {entry.meta !== undefined && <pre className="mt-2 text-[10px] text-gray-600 whitespace-pre-wrap break-words">{safeMeta}</pre>}
      </div>
    );
  };

  const exportText = filteredLogs.map((entry) => `${formatTime(entry.createdAt)} [${entry.level.toUpperCase()}] ${entry.scope}: ${maskSensitive(entry.message)}\n${maskSensitive(stringifyMeta(entry.meta))}`).join('\n\n');

  const onCopy = async (text = exportText, success = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text || 'No logs available');
      setCopyStatus(success);
    } catch {
      setCopyStatus('Clipboard failed');
    }
    setTimeout(() => setCopyStatus(null), 1800);
  };

  const onShareFile = async () => {
    const file = new File([exportText || 'No logs'], `debug-logs-${Date.now()}.txt`, { type: 'text/plain' });
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Debug logs', files: [file] });
        setCopyStatus('Shared');
        return;
      } catch {
        // fallback below
      }
    }
    await onCopy(exportText, 'Share API unavailable → copied');
  };

  const supportPacket = useMemo(() => {
    const settings = loadAppSettings();
    const last30Errors = logs.filter((entry) => entry.level === 'error').slice(0, 30);
    return JSON.stringify({
      buildVersion: (import.meta as any).env?.VITE_APP_VERSION || 'dev',
      commitHash: (import.meta as any).env?.VITE_COMMIT_HASH || 'local',
      buildDate: (import.meta as any).env?.VITE_BUILD_DATE || new Date().toISOString(),
      schemaVersion: FRONTEND_SCHEMA_VERSION,
      settings,
      syncQueueState: dbStats.mutations || null,
      lastSupabaseError: logs.find((entry) => entry.scope.includes('supabase') && entry.level === 'error') || null,
      last30Errors
    }, null, 2);
  }, [logs, dbStats]);

  const grouped = useMemo(() => {
    const map = new Map<string, SystemLogEntry[]>();
    filteredLogs.forEach((entry) => {
      const key = groupedLabel(entry.createdAt);
      const bucket = map.get(key) || [];
      bucket.push(entry);
      map.set(key, bucket);
    });
    return Array.from(map.entries());
  }, [filteredLogs]);

  return (
    <div className="p-4 pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black">Debug / Logs</h1>
        <div className="text-[11px] text-gray-500">{filteredLogs.length}/{logs.length}</div>
      </div>

      <div className="flex gap-2">
        {(['overview', 'diagnostic', 'raw'] as const).map((item) => <button key={item} className={`px-3 py-2 rounded-xl text-xs font-black ${tab === item ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`} type="button" onClick={() => setTab(item)}>{item.toUpperCase()}</button>)}
      </div>

      {copyStatus && <div className="text-[11px] font-bold text-emerald-600">{copyStatus}</div>}

      {tab === 'overview' && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border p-2 bg-white">{overview.databaseOk ? '✅' : '❌'} Database {overview.databaseOk ? 'OK' : 'mismatch'}</div>
            <div className="rounded-xl border p-2 bg-white">{overview.supabaseReachable ? '✅' : '❌'} Supabase {overview.supabaseReachable ? 'reachable' : 'error'}</div>
            <div className="rounded-xl border p-2 bg-white">{overview.authOk ? '✅' : '❌'} Auth {overview.authOk ? 'ok' : 'expired'}</div>
            <div className="rounded-xl border p-2 bg-white">✅ Sync queue: {overview.queueSize}</div>
            <div className="rounded-xl border p-2 bg-white">✅ GPS: {gps ? `${gps.accuracy.toFixed(0)}m · ${formatTime(gps.time)}` : 'n/a'}</div>
            <div className="rounded-xl border p-2 bg-white">✅ Build: {FRONTEND_SCHEMA_VERSION}</div>
          </div>
          {!schemaState.ok && <div className="rounded-xl border border-red-300 bg-red-50 p-2 text-red-700 font-bold">Что делать: {schemaState.reason}</div>}
          <button className="rounded-lg bg-blue-600 text-white px-3 py-1 font-black" type="button" onClick={() => void onCopy(`${schemaState.reason || 'No schema issues'}\nLast error: ${overview.lastError?.message || 'none'}`, 'Summary copied')}>Copy error summary</button>
          <button className="rounded-lg bg-slate-900 text-white px-3 py-1 font-black ml-2" type="button" onClick={() => void onCopy(supportPacket, 'Support packet copied')}>Copy Support Packet</button>
        </div>
      )}

      {tab === 'diagnostic' && (
        <div className="space-y-2 text-xs">
          <div className="rounded-xl border bg-white p-3 space-y-1"><div className="font-black">Network</div><p>online: {navigator.onLine ? 'yes' : 'no'}</p><p>last request: {logs.find((entry) => entry.scope.includes('supabase:request')) ? formatTime(logs.find((entry) => entry.scope.includes('supabase:request'))!.createdAt) : '—'}</p></div>
          <div className="rounded-xl border bg-white p-3 space-y-1"><div className="font-black">Local DB (IndexedDB)</div>{Object.entries(dbStats).map(([name, stat]) => <p key={name}>{name}: {stat.count} rows (~{(stat.approxBytes / 1024).toFixed(1)} KB)</p>)}</div>
          <div className="rounded-xl border bg-white p-3 space-y-1"><div className="font-black">Sync Engine</div><p>pending: {dbStats.mutations?.count || 0}</p><p>last 20 sync events:</p><ul className="list-disc pl-4">{logs.filter((entry) => entry.scope.includes('sync')).slice(0, 20).map((entry) => <li key={entry.id}>{entry.message}</li>)}</ul></div>
          <div className="rounded-xl border bg-white p-3 space-y-1"><div className="font-black">Supabase</div><p>project: {maskSensitive((import.meta as any).env?.VITE_SUPABASE_URL || 'not set')}</p><p>last error code: {(logs.find((entry) => entry.scope.includes('supabase') && entry.level === 'error')?.message.match(/code:\s*([A-Z0-9]+)/i)?.[1]) || '—'}</p></div>
          <div className="rounded-xl border bg-white p-3 space-y-1"><div className="font-black">Geo</div><p>coords: {gps ? (showExactGps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'hidden') : 'n/a'} <button className="underline" type="button" onClick={() => setShowExactGps((v) => !v)}>{showExactGps ? 'hide' : 'show'}</button></p><p>accuracy: {gps?.accuracy?.toFixed(1) || 'n/a'} m</p><p>last update: {gps ? formatTime(gps.time) : '—'}</p></div>
        </div>
      )}

      {tab === 'raw' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search logs" className="rounded-lg border p-2 col-span-2" />
            <select value={severity} onChange={(e) => setSeverity(e.target.value as any)} className="rounded-lg border p-2"><option value="all">severity: all</option><option value="info">INFO</option><option value="warn">WARN</option><option value="error">ERROR</option></select>
            <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="rounded-lg border p-2"><option value="all">scope: all</option><option value="database">database</option><option value="sync">sync</option><option value="supabase">supabase</option><option value="radar">radar</option><option value="ui">ui</option></select>
            <label className="text-xs font-bold flex items-center gap-2"><input type="checkbox" checked={maskVin} onChange={(e) => setMaskVin(e.target.checked)} />mask VIN</label>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-black" type="button" onClick={() => void loadLogs()}>Refresh</button>
            <button className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black" type="button" onClick={() => void onCopy()}>Copy Logs to Clipboard</button>
            <button className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-black" type="button" onClick={() => void onShareFile()}>Share as .txt</button>
            <button className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-black" type="button" onClick={async () => { await logger.clear(); await loadLogs(); }}>Clear Logs</button>
          </div>
          <div className="space-y-2">
            {loading ? <div className="text-xs text-gray-500">Loading logs…</div> : grouped.map(([label, items]) => (
              <div key={label} className="space-y-2"><div className="text-[11px] font-black text-gray-500 uppercase">{label}</div>{items.map(renderLog)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugLogsScreen;
