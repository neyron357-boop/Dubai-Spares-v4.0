import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ShieldAlert, Wrench } from 'lucide-react';
import { flushOfflineMutations } from '../orderStore';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { loadAppSettings, saveAppSettings, useAppSettings } from '../appSettings';
import { checkSchemaHealth } from '../schemaHealth';

const formatTs = (value?: number | null) => (value ? new Date(value).toLocaleString() : '—');

const findLastSyncSuccess = (logs: Awaited<ReturnType<typeof offlineDb.getSystemLogs>>) => logs.find((item) => item.scope.includes('sync:flush') && item.message.toLowerCase().includes('completed'))?.createdAt || null;
const findLastSyncError = (logs: Awaited<ReturnType<typeof offlineDb.getSystemLogs>>) => logs.find((item) => item.level === 'error' && (item.scope.includes('sync') || item.scope.includes('supabase')));

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="rounded-2xl border border-gray-200 bg-white p-3 space-y-3">
    <h2 className="text-sm font-black text-gray-900">{title}</h2>
    {children}
  </section>
);

const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { settings, updateSettings } = useAppSettings();
  const { syncOrders, restoreData } = useStore();
  const [syncQueue, setSyncQueue] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);

  const timezoneList = useMemo(() => ['Asia/Dubai', 'UTC', 'Europe/Moscow'], []);

  const refreshSyncState = async () => {
    const queue = await offlineDb.getMutationCount();
    const logs = await offlineDb.getSystemLogs(200);
    setSyncQueue(queue);
    setLastSyncAt(findLastSyncSuccess(logs));
    const syncError = findLastSyncError(logs);
    setLastSyncError(syncError ? `${syncError.message}` : null);
  };

  useEffect(() => {
    void refreshSyncState();
    void checkSchemaHealth().then((result) => {
      const cfg = loadAppSettings();
      if (!result.compatible && Date.now() > cfg.hideSchemaWarningUntil) {
        setSchemaWarning(result.reason || 'Schema mismatch');
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.appLanguage;
  }, [settings.appLanguage]);

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
      await refreshSyncState();
    }
  };

  return (
    <div className="min-h-full bg-gray-50 p-4 pb-24 space-y-4">
      <div
        onClick={() => {
          const next = tapCount + 1;
          setTapCount(next);
          if (next >= 5) {
            setDevUnlocked(true);
            setTapCount(0);
          }
        }}
      >
        <h1 className="text-xl font-black text-gray-900">Настройки</h1>
        <p className="text-xs text-gray-500 mt-1">Рабочие параметры, офлайн режим и диагностика</p>
      </div>

      {schemaWarning && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 space-y-2">
          <p className="font-black">{schemaWarning}</p>
          <button
            className="rounded-lg bg-rose-600 px-3 py-1 text-white font-black"
            onClick={() => {
              saveAppSettings({ hideSchemaWarningUntil: Date.now() + 24 * 60 * 60 * 1000 });
              setSchemaWarning(null);
            }}
            type="button"
          >
            Не показывать 24ч
          </button>
        </section>
      )}

      <Section title="1) Рабочие настройки">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="font-bold">Язык приложения</label>
          <select value={settings.appLanguage} onChange={(e) => updateSettings({ appLanguage: e.target.value as 'ru' | 'en' })} className="rounded-lg border p-1.5">
            <option value="ru">RU</option><option value="en">EN</option>
          </select>
          <label className="font-bold">Язык WA шаблонов</label>
          <select value={settings.waTemplateLanguage} onChange={(e) => updateSettings({ waTemplateLanguage: e.target.value as 'ru' | 'en' | 'ar' })} className="rounded-lg border p-1.5">
            <option value="ru">RU</option><option value="en">EN</option><option value="ar">AR</option>
          </select>
          <label className="font-bold">Валюта</label>
          <select value={settings.currencyFormat} onChange={(e) => updateSettings({ currencyFormat: e.target.value as 'AED' | 'USD' })} className="rounded-lg border p-1.5">
            <option value="AED">AED</option><option value="USD">USD</option>
          </select>
          <label className="font-bold">Курс по умолчанию</label>
          <input value={settings.defaultExchangeRate} onChange={(e) => updateSettings({ defaultExchangeRate: Number(e.target.value) || 0 })} className="rounded-lg border p-1.5" type="number" step="0.01" />
          <label className="font-bold">Часовой пояс</label>
          <div className="flex gap-2">
            <select value={settings.timezoneMode} onChange={(e) => updateSettings({ timezoneMode: e.target.value as 'auto' | 'manual' })} className="rounded-lg border p-1.5 flex-1"><option value="auto">Auto</option><option value="manual">Manual</option></select>
            {settings.timezoneMode === 'manual' && <select value={settings.manualTimezone} onChange={(e) => updateSettings({ manualTimezone: e.target.value })} className="rounded-lg border p-1.5 flex-1">{timezoneList.map((z) => <option key={z} value={z}>{z}</option>)}</select>}
          </div>
        </div>
      </Section>

      <Section title="2) Синхронизация и офлайн">
        <label className="flex items-center justify-between text-xs font-bold"><span>Offline-first</span><input type="checkbox" checked={settings.offlineFirst} onChange={(e) => updateSettings({ offlineFirst: e.target.checked })} /></label>
        <div className="text-xs text-gray-600 space-y-1">
          <p>Сеть: <b>{navigator.onLine ? 'Online' : 'Offline'}</b></p>
          <p>Очередь синка: <b>{syncQueue}</b></p>
          <p>Последний успешный sync: <b>{formatTs(lastSyncAt)}</b></p>
          <p>Последняя ошибка: <b>{lastSyncError || '—'}</b></p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button className="rounded-lg bg-slate-900 text-white px-2 py-1 font-black" type="button" onClick={() => void withBusy('sync', async () => { await flushOfflineMutations(); await syncOrders(); })}>Sync now</button>
          <button className="rounded-lg bg-amber-500 text-white px-2 py-1 font-black" type="button" onClick={() => void withBusy('retry', async () => { await flushOfflineMutations(); })}>Retry failed</button>
          <button className="rounded-lg bg-blue-600 text-white px-2 py-1 font-black" type="button" onClick={() => void withBusy('export', async () => {
            const payload = await offlineDb.exportAllData();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `dubai-spares-local-backup-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          })}>Export local backup</button>
          <label className="rounded-lg bg-white border px-2 py-1 font-black cursor-pointer">Import backup<input type="file" accept="application/json" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void withBusy('import', async () => {
              const raw = await file.text();
              const parsed = JSON.parse(raw);
              await offlineDb.importAllData(parsed);
              if (parsed.orders) restoreData({ orders: parsed.orders, suppliers: [] });
            });
          }} /></label>
        </div>
      </Section>

      <Section title="3) Radar Live">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="font-bold">Default mode</label>
          <select value={settings.radarDefaultMode} onChange={(e) => updateSettings({ radarDefaultMode: e.target.value as 'field' | 'detail' })} className="rounded-lg border p-1.5"><option value="field">Field</option><option value="detail">Detail</option></select>
          <label className="font-bold">Default radius</label>
          <select value={settings.radarDefaultRadiusKm} onChange={(e) => updateSettings({ radarDefaultRadiusKm: Number(e.target.value) as 2 | 5 | 10 | 20 })} className="rounded-lg border p-1.5">{[2,5,10,20].map((n) => <option key={n} value={n}>{n} km</option>)}</select>
          <label className="font-bold">Default filter</label>
          <select value={settings.radarDefaultFilter} onChange={(e) => updateSettings({ radarDefaultFilter: e.target.value as any })} className="rounded-lg border p-1.5"><option value="all">ALL</option><option value="new_only">NEW_ONLY</option><option value="used_only">USED_ONLY</option><option value="open_now">OPEN NOW</option></select>
          <label className="font-bold">GPS interval</label>
          <select value={settings.gpsUpdateInterval} onChange={(e) => updateSettings({ gpsUpdateInterval: e.target.value as any })} className="rounded-lg border p-1.5"><option value="10s">10s</option><option value="30s">30s</option><option value="manual">manual</option></select>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            ['BRAND STRICT', 'radarBrandStrict'],
            ['FALLBACK NEARBY', 'radarFallbackNearby'],
            ['Авто-скрытие HIDE', 'radarAutoHideAfterAction'],
            ['Авто-следующая точка', 'radarAutoNextPoint'],
            ['High accuracy GPS', 'gpsHighAccuracy']
          ].map(([label, key]) => (
            <label key={key} className="flex items-center justify-between rounded-lg border px-2 py-1.5 font-bold">
              <span>{label}</span>
              <input type="checkbox" checked={(settings as any)[key]} onChange={(e) => updateSettings({ [key]: e.target.checked } as any)} />
            </label>
          ))}
        </div>
      </Section>

      <Section title="4) Данные и кэш">
        <div className="flex flex-wrap gap-2 text-xs">
          <button className="rounded-lg bg-gray-900 text-white px-2 py-1 font-black" type="button" onClick={() => void withBusy('cache', async () => {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
          })}>Clear cache</button>
          <button className="rounded-lg bg-red-600 text-white px-2 py-1 font-black" type="button" onClick={() => void withBusy('offline-data', async () => {
            const first = window.confirm('⚠️ Это удалит локальные офлайн данные. Продолжить?');
            if (!first) return;
            const second = window.prompt('Введите DELETE для подтверждения');
            if (second !== 'DELETE') return;
            await offlineDb.clearAllOfflineData();
          })}>Clear offline data</button>
          <button className="rounded-lg bg-indigo-600 text-white px-2 py-1 font-black" type="button" onClick={() => void withBusy('index', async () => {
            await offlineDb.exportAllData();
          })}>Rebuild local index</button>
        </div>
      </Section>

      <Section title="5) Для разработчика">
        {!devUnlocked ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 flex items-start gap-2">
            <ShieldAlert size={16} />
            <div>Dev-раздел скрыт. Для открытия: 5 тапов по заголовку “Настройки”.</div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/debug')}
            className="w-full rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Wrench size={18} />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-gray-900">Для разработчика</p>
                <p className="text-xs text-gray-500">Debug / Logs</p>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-300" />
          </button>
        )}
      </Section>

      {busy && <div className="text-xs text-gray-500">Выполняется: {busy}…</div>}
    </div>
  );
};

export default SettingsScreen;
