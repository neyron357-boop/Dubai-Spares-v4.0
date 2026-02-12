import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ShieldAlert, Wrench } from 'lucide-react';
import { flushOfflineMutations } from '../orderStore';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { loadAppSettings, saveAppSettings, useAppSettings } from '../appSettings';
import { checkSchemaHealth } from '../schemaHealth';

const formatTs = (value?: number | null) => (value ? new Date(value).toLocaleString() : '—');

const findLastSyncSuccess = (logs: Awaited<ReturnType<typeof offlineDb.getSystemLogs>>) =>
  logs.find((item) => item.scope.includes('sync:flush') && item.message.toLowerCase().includes('completed'))?.createdAt || null;
const findLastSyncError = (logs: Awaited<ReturnType<typeof offlineDb.getSystemLogs>>) =>
  logs.find((item) => item.level === 'error' && (item.scope.includes('sync') || item.scope.includes('supabase')));

const Section: React.FC<{ title: string; children: React.ReactNode; tone?: 'default' | 'danger' }> = ({ title, children, tone = 'default' }) => (
  <section className={`rounded-2xl border p-4 space-y-3 ${tone === 'danger' ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'}`}>
    <h2 className={`text-sm font-black ${tone === 'danger' ? 'text-rose-700' : 'text-gray-900'}`}>{title}</h2>
    {children}
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5 min-w-0">
    <label className="text-xs font-bold text-gray-700">{label}</label>
    {children}
  </div>
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
    <div className="min-h-full max-w-full overflow-x-hidden bg-gray-50 p-4 pb-24 space-y-4">
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
        <p className="text-xs text-gray-500 mt-1">Рабочая панель владельца: только основные и безопасные действия</p>
      </div>

      {schemaWarning && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 space-y-2">
          <p className="font-black">{schemaWarning}</p>
          <button
            className="rounded-lg border border-rose-300 px-3 py-1 font-black"
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

      <Section title="Основные настройки">
        <div className="space-y-3">
          <Field label="Язык приложения">
            <select value={settings.appLanguage} onChange={(e) => updateSettings({ appLanguage: e.target.value as 'ru' | 'en' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </Field>

          <Field label="Язык WA шаблонов">
            <select value={settings.waTemplateLanguage} onChange={(e) => updateSettings({ waTemplateLanguage: e.target.value as 'ru' | 'en' | 'ar' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="ru">RU</option>
              <option value="en">EN</option>
              <option value="ar">AR</option>
            </select>
          </Field>

          <Field label="Валюта">
            <select value={settings.currencyFormat} onChange={(e) => updateSettings({ currencyFormat: e.target.value as 'AED' | 'USD' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="AED">AED</option>
              <option value="USD">USD</option>
            </select>
          </Field>

          <Field label="Курс по умолчанию">
            <input
              value={settings.defaultExchangeRate}
              onChange={(e) => updateSettings({ defaultExchangeRate: Number(e.target.value) || 0 })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="number"
              step="0.01"
            />
          </Field>

          <Field label="Часовой пояс">
            <div className="space-y-2">
              <select value={settings.timezoneMode} onChange={(e) => updateSettings({ timezoneMode: e.target.value as 'auto' | 'manual' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
              {settings.timezoneMode === 'manual' && (
                <select value={settings.manualTimezone || timezoneList[0]} onChange={(e) => updateSettings({ manualTimezone: e.target.value })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                  {timezoneList.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              )}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Radar Live">
        <button
          type="button"
          onClick={() => navigate('/settings/radar-live')}
          className="w-full rounded-xl border border-gray-200 bg-white p-3 flex items-center justify-between"
        >
          <div className="text-left min-w-0">
            <p className="text-sm font-black text-gray-900">Открыть настройки Radar Live</p>
            <p className="text-xs text-gray-500">Отдельный экран для режима, радиуса, GPS и переключателей</p>
          </div>
          <ChevronRight size={18} className="text-gray-300 shrink-0" />
        </button>
      </Section>

      <Section title="Синхронизация">
        <div className="text-sm text-gray-700 space-y-1">
          <p>Статус: {navigator.onLine ? '🟢 Online' : '🟠 Offline'}</p>
          <p>Очередь: {syncQueue}</p>
          <p>Последний sync: {formatTs(lastSyncAt)}</p>
          {lastSyncError && <p className="text-rose-600 text-xs">Ошибка: {lastSyncError}</p>}
        </div>

        <button className="w-full rounded-xl bg-blue-600 text-white px-3 py-2 font-black text-sm" type="button" onClick={() => void withBusy('sync', async () => {
          await flushOfflineMutations();
          await syncOrders();
        })}>
          Синхронизировать
        </button>

        <div className="flex flex-col gap-2">
          <button
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold"
            type="button"
            onClick={() => void withBusy('export', async () => {
              const payload = await offlineDb.exportAllData();
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `dubai-spares-local-backup-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            })}
          >
            Скачать backup
          </button>
          <label className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-center text-sm font-bold cursor-pointer">Import backup
            <input type="file" accept="application/json" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void withBusy('import', async () => {
                const raw = await file.text();
                const parsed = JSON.parse(raw);
                await offlineDb.importAllData(parsed);
                if (parsed.orders) restoreData({ orders: parsed.orders, suppliers: [] });
              });
            }} />
          </label>
        </div>

        <Link to="/debug" className="inline-block text-xs font-bold text-blue-600 underline underline-offset-2">→ Расширенная диагностика</Link>
      </Section>

      <Section title="Опасные действия" tone="danger">
        <div className="text-xs text-rose-700">Изменения ниже могут удалить локальные данные и требуют подтверждения.</div>
        <div className="flex flex-col gap-2 text-sm">
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black" type="button" onClick={() => void withBusy('cache', async () => {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
          })}>Очистить кэш</button>
          <button className="w-full rounded-xl border border-rose-300 bg-rose-600 text-white px-3 py-2 font-black" type="button" onClick={() => void withBusy('offline-data', async () => {
            const first = window.confirm('⚠️ Это удалит локальные офлайн данные. Продолжить?');
            if (!first) return;
            const second = window.prompt('Введите DELETE для подтверждения');
            if (second !== 'DELETE') return;
            await offlineDb.clearAllOfflineData();
          })}>Очистить офлайн данные</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black" type="button" onClick={() => void withBusy('index', async () => {
            await offlineDb.exportAllData();
          })}>Перестроить индекс</button>
        </div>
      </Section>

      {devUnlocked && (
        <Section title="Для разработчика">
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
        </Section>
      )}

      {!devUnlocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 flex items-start gap-2">
          <ShieldAlert size={16} />
          <div>Dev-раздел скрыт. Для открытия: 5 тапов по заголовку “Настройки”.</div>
        </div>
      )}

      {busy && <div className="text-xs text-gray-500">Выполняется: {busy}…</div>}
    </div>
  );
};

export default SettingsScreen;
