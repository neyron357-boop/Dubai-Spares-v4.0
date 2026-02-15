import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ShieldAlert, Wrench } from 'lucide-react';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { backupUpload, isServerApiAvailable } from '../serverApi';
import { AppSettings, useAppSettings } from '../appSettings';

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
  const [serverStatus, setServerStatus] = useState<'available' | 'unavailable'>(() => (isServerApiAvailable() ? 'available' : 'unavailable'));
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupController, setBackupController] = useState<AbortController | null>(null);

  const timezoneList = useMemo(() => ['Asia/Dubai', 'UTC', 'Europe/Moscow'], []);


  useEffect(() => {
    document.documentElement.lang = settings.appLanguage;
  }, [settings.appLanguage]);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  const updateDraft = (patch: Partial<AppSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...patch }));
    setSaveNotice(null);
  };

  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);

  const saveChanges = () => {
    updateSettings(draftSettings);
    setSaveNotice('Изменения сохранены и применены во всех разделах.');
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
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
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="w-full rounded-xl bg-blue-600 text-white px-3 py-2 font-black text-sm disabled:opacity-50"
            type="button"
            disabled={!!backupController}
            onClick={() => void withBusy('backup-upload', async () => {
              const payload = exportData();
              const controller = new AbortController();
              setBackupController(controller);
              setBackupProgress(15);
              try {
                await backupUpload(payload, { signal: controller.signal });
                setServerStatus('available');
                setBackupProgress(100);
              } catch {
                setServerStatus('unavailable');
                throw new Error('Backup upload failed');
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
