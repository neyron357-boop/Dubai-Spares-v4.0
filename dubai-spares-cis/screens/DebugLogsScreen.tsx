import React, { useEffect, useMemo, useState } from 'react';
import { logger } from '../logging';
import { SystemLogEntry } from '../types';

const MAX_VISIBLE_LOGS = 500;
const INITIAL_RENDER_COUNT = 80;
const LOAD_MORE_STEP = 80;

const formatTime = (value: number) => new Date(value).toLocaleString();
const shortText = (value: string, max = 3000) => (value.length > max ? `${value.slice(0, max)}…` : value);
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

const toLogText = (entry: SystemLogEntry) => {
  const safeMeta = toPreviewMeta(entry.meta);
  return `[${entry.level.toUpperCase()}] ${new Date(entry.createdAt).toISOString()} ${entry.scope}: ${maskSensitive(entry.message)}${safeMeta ? `\n${safeMeta}` : ''}`;
};

const DebugLogsScreen: React.FC = () => {
  const [logs, setLogs] = useState<SystemLogEntry[]>(() => logger.getRecentBuffered(MAX_VISIBLE_LOGS));
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'errors' | 'other'>('all');

  useEffect(() => {
    void logger.getRecentStored(MAX_VISIBLE_LOGS).then((next) => setLogs(next));
  }, []);

  useEffect(() => {
    const onLogUpdated = () => setLogs(logger.getRecentBuffered(MAX_VISIBLE_LOGS));
    window.addEventListener('system-log-updated', onLogUpdated);
    return () => window.removeEventListener('system-log-updated', onLogUpdated);
  }, []);

  const filteredLogs = useMemo(() => logs.filter((entry) => {
    if (typeFilter === 'errors' && entry.level !== 'error') return false;
    if (typeFilter === 'other' && entry.level === 'error') return false;
    if (!query.trim()) return true;
    const haystack = `${entry.scope} ${entry.message} ${toPreviewMeta(entry.meta)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [logs, query, typeFilter]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, visibleCount), [filteredLogs, visibleCount]);

  const handleCopyAll = async () => {
    try {
      const payload = filteredLogs.map(toLogText).join('\n\n');
      await navigator.clipboard.writeText(payload || 'Логи пусты');
      setCopyStatus('Все логи скопированы');
    } catch {
      setCopyStatus('Не удалось скопировать логи');
    }
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  return (
    <div className="p-4 pb-24 space-y-3 overflow-x-hidden">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-black">Логи</h1>
        <button className="rounded-lg bg-slate-900 text-white px-3 py-2 text-xs font-black" type="button" onClick={() => void handleCopyAll()}>
          Копировать все
        </button>
      </div>

      <p className="text-xs text-gray-500">Логи хранятся только локально на этом устройстве.</p>
      {copyStatus && <div className="text-[11px] font-bold text-emerald-600">{copyStatus}</div>}

      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по логам" className="rounded-lg border p-2 sm:col-span-2" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | 'errors' | 'other')} className="rounded-lg border p-2">
          <option value="all">Все типы</option>
          <option value="errors">Ошибки</option>
          <option value="other">Другие</option>
        </select>
        <div className="rounded-lg border p-2">Показано {visibleLogs.length}/{filteredLogs.length}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black" type="button" onClick={() => setLogs(logger.getRecentBuffered(MAX_VISIBLE_LOGS))}>
          Обновить
        </button>
        <button className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-black" type="button" onClick={async () => {
          await logger.clear();
          setLogs([]);
          setVisibleCount(INITIAL_RENDER_COUNT);
        }}>
          Очистить логи
        </button>
      </div>

      <div className="space-y-2">
        {visibleLogs.map((entry) => {
          const safeMeta = toPreviewMeta(entry.meta);
          return (
            <div key={entry.id} className="p-3 rounded-xl bg-white border border-gray-200">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase text-gray-600">{entry.scope}</div>
                <div className="text-[10px] text-gray-400">{formatTime(entry.createdAt)}</div>
              </div>
              <div className="text-xs font-bold mt-1 break-words">
                <span className={`mr-2 ${entry.level === 'error' ? 'text-red-600' : entry.level === 'warn' ? 'text-amber-600' : 'text-blue-600'}`}>{entry.level.toUpperCase()}</span>
                {maskSensitive(entry.message)}
              </div>
              {safeMeta && <div className="mt-2 text-[10px] text-gray-600 whitespace-pre-wrap break-words">{safeMeta}</div>}
            </div>
          );
        })}
      </div>

      {visibleCount < filteredLogs.length && (
        <button className="px-3 py-2 rounded-xl bg-gray-100 text-xs font-black" type="button" onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_STEP)}>
          Показать ещё
        </button>
      )}
    </div>
  );
};

export default DebugLogsScreen;
