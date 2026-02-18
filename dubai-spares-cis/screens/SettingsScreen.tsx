import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ShieldAlert, Wrench } from 'lucide-react';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { backupUpload, leadsSync } from '../serverApi';
import { cloudBuildGuardMessage, cloudDiagnosticsText, cloudFeatureFlags, getLastCloudCall, isCloudConfigured, SUPABASE_HOST } from '../cloudConfig';
import { AppSettings, useAppSettings } from '../appSettings';
import { testSupabaseConnection } from '../utils/testSupabaseConnection';

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
  const { restoreData, exportData } = useStore();
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'available' | 'unavailable'>(() => (isCloudConfigured ? 'available' : 'unavailable'));
  const [lastCloudResult, setLastCloudResult] = useState(() => getLastCloudCall());
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupController, setBackupController] = useState<AbortController | null>(null);
  const [lastBackupId, setLastBackupId] = useState('');
  const [requestCount, setRequestCount] = useState<number>(() => ((window as any).__serverApiRequestCount || 0));
  const [isSyncingLeads, setIsSyncingLeads] = useState(false);

  const timezoneList = useMemo(() => ['Asia/Dubai', 'UTC', 'Europe/Moscow'], []);


  useEffect(() => {
    document.documentElement.lang = settings.appLanguage;
  }, [settings.appLanguage]);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);


  useEffect(() => {
    const onCloudCall = (event: Event) => setLastCloudResult((event as CustomEvent).detail);
    window.addEventListener('cloud:last-call', onCloudCall as EventListener);
    const onRequest = (event: Event) => {
      const count = Number((event as CustomEvent<{ count?: number }>).detail?.count || 0);
      setRequestCount(count);
    };
    window.addEventListener('server-api:request', onRequest as EventListener);
    return () => {
      window.removeEventListener('server-api:request', onRequest as EventListener);
      window.removeEventListener('cloud:last-call', onCloudCall as EventListener);
    };
  }, []);


  const updateDraft = (patch: Partial<AppSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...patch }));
    setSaveNotice(null);
  };

  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);

  const saveChanges = () => {
    updateSettings(draftSettings);
    setSaveNotice('Изменения сохранены и применены во всех разделах.');
  };


  const buildCompactBackupPayload = () => {
    const raw = exportData();
    return {
      ...raw,
      orders: (raw.orders || []).map((order: any) => ({
        ...order,
        carPhotoUrl: '',
        carPhotos: [],
        vinPhotoUrl: '',
        parts: (order.parts || []).map((part: any) => ({
          ...part,
          photoUrl: '',
          photos: [],
          variants: (part.variants || []).map((variant: any) => ({
            ...variant,
            photoUrl: '',
            photos: []
          }))
        }))
      }))
    };
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud action failed';
      alert(`${message}. Use "Copy diagnostics" and retry.`);
    } finally {
      setBusy(null);
    }
  };


  const handleManualLeadsSync = async () => {
    setIsSyncingLeads(true);
    console.log('[Settings] Manual leads sync started');

    try {
      const result = await leadsSync();

      if (result.ok) {
        console.log('[Settings] Leads synced:', result.data?.length);
        alert(`✅ Синхронизировано лидов: ${result.data?.length || 0}`);
      } else {
        console.error('[Settings] Sync failed:', result.error);
        alert(`❌ Ошибка синхронизации: ${result.error}`);
      }
    } catch (error) {
      console.error('[Settings] Sync exception:', error);
      alert(`❌ Исключение: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSyncingLeads(false);
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


      <Section title="Основные настройки">
        <div className="space-y-3">
          <Field label="Язык приложения">
            <select value={draftSettings.appLanguage} onChange={(e) => {
              const nextLang = e.target.value as 'ru' | 'en';
              updateDraft({ appLanguage: nextLang });
              updateSettings({ appLanguage: nextLang });
            }} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </Field>

          <Field label="Язык WA шаблонов">
            <select value={draftSettings.waTemplateLanguage} onChange={(e) => updateDraft({ waTemplateLanguage: e.target.value as 'ru' | 'en' | 'ar' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="ru">RU</option>
              <option value="en">EN</option>
              <option value="ar">AR</option>
            </select>
          </Field>

          <Field label="Валюта">
            <select value={draftSettings.currencyFormat} onChange={(e) => updateDraft({ currencyFormat: e.target.value as 'AED' | 'USD' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="AED">AED</option>
              <option value="USD">USD</option>
            </select>
          </Field>

          <Field label="Курс по умолчанию">
            <input
              value={draftSettings.defaultExchangeRate}
              onChange={(e) => updateDraft({ defaultExchangeRate: Number(e.target.value) || 0 })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="number"
              step="0.01"
            />
          </Field>

          <Field label="Часовой пояс">
            <div className="space-y-2">
              <select value={draftSettings.timezoneMode} onChange={(e) => updateDraft({ timezoneMode: e.target.value as 'auto' | 'manual' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
              {draftSettings.timezoneMode === 'manual' && (
                <select value={draftSettings.manualTimezone || timezoneList[0]} onChange={(e) => updateDraft({ manualTimezone: e.target.value })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                  {timezoneList.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              )}
            </div>
          </Field>

          <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
            <span className="text-sm font-bold text-gray-800">Field Focus Mode</span>
            <input
              type="checkbox"
              checked={draftSettings.fieldFocusMode}
              onChange={(e) => updateDraft({ fieldFocusMode: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
        </div>
      </Section>

      <Section title="Публичные контакты">
        <div className="space-y-3">
          <Field label="WhatsApp номер для ссылки в заявке и смете">
            <input
              value={draftSettings.publicWhatsappNumber}
              onChange={(e) => updateDraft({ publicWhatsappNumber: e.target.value.replace(/[^\d]/g, '') })}
              placeholder="971521574546"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Telegram ссылка">
            <input
              value={draftSettings.publicTelegramUrl}
              onChange={(e) => updateDraft({ publicTelegramUrl: e.target.value.trim() })}
              placeholder="https://t.me/your_account"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Instagram ссылка">
            <input
              value={draftSettings.publicInstagramUrl}
              onChange={(e) => updateDraft({ publicInstagramUrl: e.target.value.trim() })}
              placeholder="https://instagram.com/your_account"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Условия доставки (для сметы клиенту)">
            <textarea
              value={draftSettings.publicDeliveryTerms}
              onChange={(e) => updateDraft({ publicDeliveryTerms: e.target.value })}
              placeholder="Например: Доставка 3-8 рабочих дней после подтверждения и оплаты."
              className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Условия работы (для сметы клиенту)">
            <textarea
              value={draftSettings.publicWorkTerms}
              onChange={(e) => updateDraft({ publicWorkTerms: e.target.value })}
              placeholder="Например: Проверка наличия/цены перед оплатой, фото-отчёт перед отправкой."
              className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
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

      <Section title="Локальный режим">
        <div className="text-sm text-gray-700 space-y-1">
          <p>Режим: <b>LOCAL</b></p>
          <p>Server: {serverStatus === 'available' ? 'available' : 'unavailable'}</p>
          <p>Supabase requests (dev check): {requestCount}</p>
          {!isCloudConfigured && <p className="text-rose-600">{cloudBuildGuardMessage}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="w-full rounded-xl bg-blue-600 text-white px-3 py-2 font-black text-sm disabled:opacity-50"
            type="button"
            disabled={!!backupController || !isCloudConfigured}
            onClick={() => void withBusy('backup-upload', async () => {
              const controller = new AbortController();
              setBackupController(controller);
              setBackupProgress(15);
              try {
                const payload = buildCompactBackupPayload();
                const uploaded = await backupUpload(payload, { signal: controller.signal });
                if (!uploaded.ok) {
                  setServerStatus('unavailable');
                  throw new Error(uploaded.error);
                }
                setLastBackupId(uploaded.data.backupId);
                setServerStatus('available');
                setBackupProgress(100);
              } catch (error) {
                throw new Error(error instanceof Error ? error.message : 'Backup upload failed');
              } finally {
                window.setTimeout(() => setBackupProgress(0), 600);
                setBackupController(null);
              }
            })}
          >
            Backup now
          </button>

          {backupController && (
            <button className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold" type="button" onClick={() => backupController.abort('user-cancelled')}>
              Cancel backup
            </button>
          )}

          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${backupProgress}%` }} />
          </div>

          <div className="flex gap-2">
            <input
              value={lastBackupId}
              onChange={(e) => setLastBackupId(e.target.value.trim())}
              placeholder="Backup ID"
              className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
            <button
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
              type="button"
              disabled={!lastBackupId || !!backupController}
              onClick={() => void withBusy('backup-restore', async () => {
                const controller = new AbortController();
                setBackupController(controller);
                try {
                  const backup = await backupUpload({}, { mode: 'restore', backupId: lastBackupId, signal: controller.signal, timeoutMs: 45000 });
                  if (!backup.ok || !backup.data.payload) throw new Error(backup.ok ? 'Backup payload missing' : backup.error);
                  await offlineDb.importAllData(backup.data.payload);
                  if ((backup.data.payload as any)?.orders) restoreData({ orders: (backup.data.payload as any).orders, suppliers: [] });
                  setServerStatus('available');
                } finally {
                  setBackupController(null);
                }
              })}
            >
              Restore by ID
            </button>
          </div>

          <label className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-center text-sm font-bold cursor-pointer">Restore from backup
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

        <div className="flex gap-3">
          <button type="button" className="text-xs font-bold text-blue-600 underline underline-offset-2 text-left" onClick={() => { (window as any).__serverApiRequestCount = 0; setRequestCount(0); }}>Reset request counter</button>
          <button type="button" className="text-xs font-bold text-blue-600 underline underline-offset-2 text-left" onClick={() => navigator.clipboard.writeText(cloudDiagnosticsText())}>Copy diagnostics</button>
          <button
            type="button"
            className="text-xs font-bold text-emerald-700 underline underline-offset-2 text-left disabled:opacity-50"
            disabled={!isCloudConfigured || busy === 'cloud-test'}
            onClick={() => void withBusy('cloud-test', async () => {
              const result = await testSupabaseConnection();
              if (!result.success) throw new Error('Supabase test connection failed');
            })}
          >
            Test Connection
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleManualLeadsSync()}
          disabled={isSyncingLeads || !cloudFeatureFlags.clientForm}
          className="w-full rounded-xl border border-blue-300 bg-blue-600 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSyncingLeads ? '⏳ Синхронизация...' : '🔄 Синхронизировать лиды'}
        </button>
        {devUnlocked && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
            <p className="font-black text-gray-900">Cloud diagnostics (dev)</p>
            <p>Supabase host: {SUPABASE_HOST || 'invalid'}</p>
            <p>Features: backup={String(cloudFeatureFlags.backup)}, quote={String(cloudFeatureFlags.publicQuote)}, form={String(cloudFeatureFlags.clientForm)}</p>
            <p>Last call: {lastCloudResult ? `${lastCloudResult.action} • ${lastCloudResult.ok ? 'ok' : lastCloudResult.code}` : 'none'}</p>
          </div>
        )}
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

      <div className="sticky bottom-2 z-30 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={saveChanges}
          disabled={!hasUnsavedChanges}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Сохранить изменения
        </button>
        {saveNotice && <p className="mt-1 text-center text-[11px] font-semibold text-emerald-600">{saveNotice}</p>}
      </div>

      {busy && <div className="text-xs text-gray-500">Выполняется: {busy}…</div>}
    </div>
  );
};

export default SettingsScreen;
