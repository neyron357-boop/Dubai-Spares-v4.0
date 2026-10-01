import {
  Building2,
  CheckCircle2,
  Download,
  FileJson,
  HardDrive,
  ImagePlus,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AppSettings, useAppSettings } from '../appSettings';
import { Button, Dialog, Field, PageHeader, Panel } from '../components/ui';
import { toast } from '../feedback';
import { localDocuments } from '../storage/localDocuments';
import { saveLocalFile, saveLocalImage } from '../storage/photos';
import { useStore } from '../store';
import {
  createLocalBackup,
  downloadJson,
  restoreLocalBackup,
  validateLocalBackup,
  type LocalBackup,
} from '../utils/localBackup';
import { normalizePublicQuoteSnapshotPayload } from '../utils/publicQuoteSnapshot';

const tabs = [
  { key: 'general', title: 'Основные', icon: SlidersHorizontal },
  { key: 'company', title: 'Компания', icon: Building2 },
  { key: 'system', title: 'Система', icon: HardDrive },
] as const;
function SettingField({
  label,
  value,
  onSave,
  type = 'text',
  hint,
  multiline,
}: {
  label: string;
  value: string | number;
  onSave: (value: string) => void;
  type?: string;
  hint?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const save = () => {
    if (draft !== String(value)) onSave(draft);
  };
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <textarea
          className="ui-input"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
        />
      ) : (
        <input
          className="ui-input"
          type={type}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      )}
    </Field>
  );
}
export default function SettingsScreen() {
  const { settings, updateSettings } = useAppSettings(),
    { orders, suppliers } = useStore();
  const [tab, setTab] = useState<'general' | 'company' | 'system'>('general'),
    [busy, setBusy] = useState(false),
    [candidate, setCandidate] = useState<LocalBackup | null>(null),
    [error, setError] = useState(''),
    [usage, setUsage] = useState<StorageEstimate | null>(null);
  const [cargoCountry, setCargoCountry] = useState(settings.cargoTariffs[0]?.country || '');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void navigator.storage?.estimate().then(setUsage);
  }, [orders.length]);
  const save = (patch: Partial<AppSettings>) => {
    try {
      updateSettings(patch);
      toast('Настройки сохранены', 'success');
    } catch {
      toast('Не удалось сохранить настройки. Проверьте свободное место.', 'error');
    }
  };
  const textSetting = (
    label: string,
    key: keyof AppSettings,
    options?: { type?: string; hint?: string; multiline?: boolean },
  ) => (
    <SettingField
      key={key}
      label={label}
      value={settings[key] as string | number}
      onSave={(value) => save({ [key]: value })}
      {...options}
    />
  );
  const exportBackup = async () => {
    setBusy(true);
    setError('');
    try {
      const backup = await createLocalBackup();
      downloadJson(backup, `stark-backup-${new Date().toISOString().slice(0, 10)}.json`);
      localStorage.setItem('stark_last_backup_at', new Date().toISOString());
      toast('Резервная копия сохранена в файл', 'success');
    } catch {
      setError('Не удалось создать резервную копию. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  };
  const selectBackup = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 150 * 1024 * 1024)
        throw new Error('Файл слишком большой. Максимум — 150 МБ.');
      setCandidate(validateLocalBackup(JSON.parse(await file.text())));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Не удалось прочитать файл');
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const restore = async () => {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      await restoreLocalBackup(candidate);
      setCandidate(null);
      toast('Резервная копия восстановлена', 'success');
    } catch (exception) {
      setCandidate(null);
      setError(exception instanceof Error ? exception.message : 'Не удалось восстановить данные');
    } finally {
      setBusy(false);
    }
  };
  const openQuoteFile = async (file?: File) => {
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text());
      const normalized = normalizePublicQuoteSnapshotPayload(snapshot.payload || snapshot);
      if (!normalized?.hasRenderableContent) throw new Error('В файле нет сметы.');
      const token = crypto.randomUUID().replace(/-/g, '');
      await localDocuments.set(`quote:${token}`, { ...snapshot, token, payload: normalized.raw });
      window.location.hash = `#/q/${token}?token=${token}`;
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Не удалось открыть смету');
    }
  };
  const uploadAsset = async (file: File | undefined, key: keyof AppSettings, image = true) => {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Максимальный размер файла — 15 МБ.');
      const data = image ? await saveLocalImage(file) : await saveLocalFile(file);
      save({
        [key]: data,
        ...(key === 'publicTermsFileUrl' ? { publicTermsFileName: file.name } : {}),
      });
    } catch (exception) {
      toast(exception instanceof Error ? exception.message : 'Не удалось сохранить файл', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ui-page settings-page">
      <PageHeader
        eyebrow="Рабочее пространство"
        title="Настройки"
        description="Ваши предпочтения, данные компании и резервные копии."
      />
      <div className="ui-segmented" role="tablist" aria-label="Разделы настроек">
        {tabs.map(({ key, title, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex((item) => item.key === key);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              setTab(tabs[next].key);
              setError('');
              document.getElementById(`tab-${tabs[next].key}`)?.focus();
            }}
            aria-controls={`settings-${key}`}
            id={`tab-${key}`}
            onClick={() => {
              setTab(key);
              setError('');
            }}
            className={tab === key ? 'is-active' : ''}
          >
            <Icon size={17} />
            {title}
          </button>
        ))}
      </div>
      <div
        key={tab}
        id={`settings-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="ui-page-stack ui-enter"
      >
        {tab === 'general' && (
          <>
            <Panel title="Личные настройки" icon={SlidersHorizontal}>
              <div className="ui-form-grid">
                {textSetting('Ваше имя', 'userName')}
                <SettingField
                  label="Курс: AED за 1 USD"
                  type="number"
                  value={settings.defaultExchangeRate}
                  hint="Используется для новых заказов"
                  onSave={(value) => {
                    const number = Number(value);
                    if (number > 0 && Number.isFinite(number))
                      save({ defaultExchangeRate: number });
                    else toast('Введите курс больше нуля', 'error');
                  }}
                />
              </div>
              <label className="ui-toggle-row">
                <span>
                  <Volume2 size={19} />
                  <span>
                    <strong>Звуки интерфейса</strong>
                    <small>Короткий сигнал при действии</small>
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.soundsEnabled}
                  onChange={(event) => save({ soundsEnabled: event.target.checked })}
                />
              </label>
            </Panel>
            <Panel
              title="Курсы для сметы"
              description="Стоимость одной единицы AED в выбранной валюте."
            >
              <div className="ui-form-grid">
                {Object.entries(settings.defaultQuoteRates)
                  .filter(([code]) => code !== 'AED')
                  .map(([code, value]) => (
                    <SettingField
                      key={code}
                      label={`1 AED → ${code}`}
                      type="number"
                      value={value}
                      onSave={(raw) => {
                        const next = Number(raw);
                        if (next > 0 && Number.isFinite(next))
                          save({
                            defaultQuoteRates: { ...settings.defaultQuoteRates, [code]: next },
                          });
                        else toast('Введите положительное значение', 'error');
                      }}
                    />
                  ))}
              </div>
            </Panel>
            <Panel title="Работа с поставщиками" description="Чек-лист доступен в каждом заказе.">
              <Field label="Пункты чек-листа" hint="Каждый пункт с новой строки">
                <textarea
                  className="ui-input"
                  rows={5}
                  defaultValue={settings.defaultVendorChecklist.join('\n')}
                  onBlur={(event) =>
                    save({
                      defaultVendorChecklist: event.target.value
                        .split('\n')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            </Panel>
            <Panel title="Тарифы доставки" description="USD за кг; сроки указываются в днях.">
              <Field label="Страна доставки">
                <select
                  className="ui-input mb-5"
                  value={cargoCountry}
                  onChange={(event) => setCargoCountry(event.target.value)}
                >
                  {settings.cargoTariffs.map((tariff) => (
                    <option key={tariff.country}>{tariff.country}</option>
                  ))}
                </select>
              </Field>
              <div className="space-y-5">
                {settings.cargoTariffs.map((tariff, index) =>
                  cargoCountry === tariff.country ? (
                    <div key={tariff.country}>
                      <h3 className="font-semibold mb-3">{tariff.country}</h3>
                      <div className="ui-form-grid">
                        {(
                          [
                            'airRegularUsdPerKg',
                            'airOversizedUsdPerKg',
                            'containerUsdPerKg',
                            'airSeatUsd',
                            'minAirKg',
                            'minContainerKg',
                            'airEtaDays',
                            'containerEtaDays',
                          ] as const
                        ).map((key) => (
                          <SettingField
                            key={key}
                            label={
                              {
                                airRegularUsdPerKg: 'Авиа · USD/кг',
                                airOversizedUsdPerKg: 'Негабарит · USD/кг',
                                containerUsdPerKg: 'Контейнер · USD/кг',
                                airSeatUsd: 'Доплата за место · USD',
                                minAirKg: 'Минимум авиа · кг',
                                minContainerKg: 'Минимум контейнера · кг',
                                airEtaDays: 'Срок авиа',
                                containerEtaDays: 'Срок контейнера',
                              }[key]
                            }
                            type={key.endsWith('Days') ? 'text' : 'number'}
                            value={tariff[key]}
                            onSave={(raw) => {
                              const value = key.endsWith('Days') ? raw : Number(raw);
                              if (
                                typeof value === 'number' &&
                                (!Number.isFinite(value) || value < 0)
                              ) {
                                toast('Введите число от нуля', 'error');
                                return;
                              }
                              save({
                                cargoTariffs: settings.cargoTariffs.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, [key]: value } : item,
                                ),
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            </Panel>
          </>
        )}
        {tab === 'company' && (
          <>
            <Panel title="Контакты компании" icon={Building2}>
              <div className="ui-form-grid">
                {textSetting('Имя менеджера', 'publicManagerName')}
                {textSetting('WhatsApp', 'publicWhatsappNumber', { type: 'tel' })}
                {textSetting('Email', 'publicEmail', { type: 'email' })}
                {textSetting('Сайт', 'publicWebsiteUrl', { type: 'url' })}
                {textSetting('Telegram', 'publicTelegramUrl', { type: 'url' })}
                {textSetting('Instagram', 'publicInstagramUrl', { type: 'url' })}
              </div>
            </Panel>
            <Panel title="Оформление документов">
              <div className="ui-form-grid">
                {(
                  ['publicCompanyLogoUrl', 'publicInvoiceSignatureUrl', 'executorPhotoUrl'] as const
                ).map((key, index) => (
                  <div key={key} className="ui-asset-field">
                    <span>{['Логотип компании', 'Подпись в счёте', 'Фото менеджера'][index]}</span>
                    {settings[key] && (
                      <img
                        src={settings[key]}
                        alt={['Логотип компании', 'Подпись в счёте', 'Фото менеджера'][index]}
                      />
                    )}
                    <label className="ui-button ui-button-secondary cursor-pointer">
                      <ImagePlus size={18} />
                      Выбрать изображение
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={busy}
                        onChange={(event) => void uploadAsset(event.target.files?.[0], key)}
                      />
                    </label>
                    {settings[key] && (
                      <Button variant="ghost" onClick={() => save({ [key]: '' })}>
                        Убрать
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="ui-form-grid mt-6">
                {textSetting('Должность менеджера', 'executorRole')}
                {textSetting('Получатель платежа', 'invoicePaymentBeneficiary')}
                {textSetting('Банк', 'invoicePaymentBankAccount')}
                {textSetting('Номер счёта', 'invoicePaymentAccountNo')}
              </div>
            </Panel>
            <Panel title="Условия работы">
              <div className="space-y-5">
                {textSetting('Условия заказа', 'publicWorkTerms', { multiline: true })}
                {textSetting('Условия доставки', 'publicDeliveryTerms', { multiline: true })}
                <label className="ui-button ui-button-secondary cursor-pointer">
                  <Upload size={18} />
                  {settings.publicTermsFileName || 'Прикрепить условия в PDF'}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={(event) =>
                      void uploadAsset(event.target.files?.[0], 'publicTermsFileUrl', false)
                    }
                  />
                </label>
              </div>
            </Panel>
          </>
        )}
        {tab === 'system' && (
          <>
            <Panel title="Данные на устройстве" icon={HardDrive}>
              <div className="ui-stats-grid">
                <div>
                  <strong>{orders.length}</strong>
                  <span>Заказов</span>
                </div>
                <div>
                  <strong>{suppliers.length}</strong>
                  <span>Поставщиков</span>
                </div>
                <div>
                  <strong>
                    {usage?.usage ? `${(usage.usage / 1024 / 1024).toFixed(1)} МБ` : '—'}
                  </strong>
                  <span>Занято в браузере</span>
                </div>
              </div>
              <p className="ui-notice">
                <ShieldCheck size={20} />
                Заказы, фотографии и документы сохраняются в этом браузере. Регулярно скачивайте
                резервную копию: очистка данных браузера удаляет локальную базу.
              </p>
              <Button
                variant="secondary"
                onClick={async () => {
                  const persistent = await navigator.storage?.persist();
                  toast(
                    persistent
                      ? 'Браузер защитил данные от автоматического удаления'
                      : 'Браузер управляет хранением автоматически. Сохраняйте резервные копии.',
                    persistent ? 'success' : 'info',
                  );
                }}
              >
                Защитить локальное хранение
              </Button>
            </Panel>
            <Panel
              title="Резервная копия"
              icon={Download}
              description="Содержит заказы, фотографии, поставщиков, варианты цен, настройки и сметы."
            >
              <div className="flex flex-wrap gap-3">
                <Button icon={Download} loading={busy} onClick={() => void exportBackup()}>
                  Экспорт локального бэкапа
                </Button>
                <label
                  className={`ui-button ui-button-secondary cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <Upload size={18} />
                  Восстановить из файла
                  <input
                    ref={fileRef}
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    disabled={busy}
                    onChange={(event) => void selectBackup(event.target.files?.[0])}
                  />
                </label>
              </div>
            </Panel>
            <Panel
              title="Смета из файла"
              icon={FileJson}
              description="Откройте смету с фотографиями, полученную от менеджера."
            >
              <label className="ui-button ui-button-secondary cursor-pointer">
                <FileJson size={18} />
                Открыть смету
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void openQuoteFile(event.target.files?.[0])}
                />
              </label>
            </Panel>
            <div className="ui-version">
              <CheckCircle2 size={16} />
              STARK MOTORS · Локальная версия 5.0
            </div>
          </>
        )}
        {error && (
          <div className="ui-error" role="alert">
            {error}
          </div>
        )}
      </div>
      {candidate && (
        <Dialog
          title="Восстановить резервную копию?"
          onClose={() => {
            if (!busy) setCandidate(null);
          }}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setCandidate(null)}>
                Отмена
              </Button>
              <Button loading={busy} onClick={() => void restore()}>
                Восстановить данные
              </Button>
            </>
          }
        >
          <p className="ui-description">
            В файле {candidate.orders.length} заказов
            {candidate.suppliers ? ` и ${candidate.suppliers.length} поставщиков` : ''}. Текущие
            заказы будут заменены. Сначала сохраните их резервную копию, если они нужны.
          </p>
        </Dialog>
      )}
    </div>
  );
}
