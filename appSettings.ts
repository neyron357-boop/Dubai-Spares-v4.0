import { useEffect, useState } from 'react';
import { publishDomainEvent } from './domainEvents';
import { supabase } from './supabase';
import { CargoTariff, DEFAULT_CARGO_TARIFFS } from './utils/cargo';

export const APP_SETTINGS_KEY = 'dubai_spares_app_settings_v1';
const CLOUD_APP_SETTINGS_ID = 'app_settings';
const CLOUD_PUBLIC_SETTINGS_ID = 'public_settings';

export type AppLanguage = 'ru' | 'en';
export type WhatsAppTemplateLanguage = 'ru' | 'en' | 'ar';
export type CurrencyFormat = 'AED' | 'USD';
export type TimezoneMode = 'auto' | 'manual';
export type RadarDefaultMode = 'field' | 'detail';
export type RadarDefaultFilter = 'all' | 'new_only' | 'used_only' | 'open_now';
export type GpsUpdateInterval = '10s' | '30s' | 'manual';
export type AppQuoteCurrency = 'AED' | 'USD' | 'RUB' | 'TJS' | 'KZT' | 'UZS';
export type AppQuoteRates = Record<AppQuoteCurrency, number>;

export const DEFAULT_APP_QUOTE_RATES: AppQuoteRates = {
  AED: 1,
  USD: 0.27,
  RUB: 21,
  TJS: 2.6,
  KZT: 125,
  UZS: 3400
};

export interface AppSettings {
  defaultVendorChecklist: string[];
  appLanguage: AppLanguage;
  waTemplateLanguage: WhatsAppTemplateLanguage;
  currencyFormat: CurrencyFormat;
  defaultExchangeRate: number;
  defaultQuoteRates: AppQuoteRates;
  timezoneMode: TimezoneMode;
  manualTimezone: string;
  offlineFirst: boolean;
  radarDefaultMode: RadarDefaultMode;
  radarDefaultRadiusKm: 2 | 5 | 10 | 20;
  radarDefaultFilter: RadarDefaultFilter;
  radarBrandStrict: boolean;
  radarFallbackNearby: boolean;
  radarAutoHideAfterAction: boolean;
  radarAutoNextPoint: boolean;
  gpsHighAccuracy: boolean;
  gpsUpdateInterval: GpsUpdateInterval;
  fieldFocusMode: boolean;
  soundsEnabled: boolean;
  hideSchemaWarningUntil: number;
  publicWhatsappNumber: string;
  publicTelegramUrl: string;
  publicInstagramUrl: string;
  publicWebsiteUrl: string;
  publicEmail: string;
  publicDeliveryTerms: string;
  publicWorkTerms: string;
  publicCompanyLogoUrl: string;
  publicInvoiceSignatureUrl: string;
  publicManagerName: string;
  invoicePaymentAccountNo: string;
  invoicePaymentBeneficiary: string;
  invoicePaymentBankAccount: string;
  publicTermsFileUrl: string;
  publicTermsFileName: string;
  executorPhotoUrl: string;
  executorRole: string;
  publicContactsUpdatedAt: number;
  appSettingsUpdatedAt: number;
  cargoTariffs: CargoTariff[];
  weeklyGoalAed: number;
  morningNotificationTime: string;
  eveningNotificationTime: string;
  userName: string;
  orderZones: string[];
  aiCoreApiKey: string;
}

type PublicAppSettings = Pick<AppSettings, 'publicWhatsappNumber' | 'publicTelegramUrl' | 'publicInstagramUrl' | 'publicWebsiteUrl' | 'publicEmail' | 'publicDeliveryTerms' | 'publicWorkTerms' | 'publicCompanyLogoUrl' | 'publicInvoiceSignatureUrl' | 'publicManagerName' | 'invoicePaymentAccountNo' | 'invoicePaymentBeneficiary' | 'invoicePaymentBankAccount' | 'publicTermsFileUrl' | 'publicTermsFileName' | 'executorPhotoUrl' | 'executorRole'>;
type CloudPublicSettings = PublicAppSettings & Pick<AppSettings, 'publicContactsUpdatedAt'>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultVendorChecklist: [],
  appLanguage: 'ru',
  waTemplateLanguage: 'ru',
  currencyFormat: 'AED',
  defaultExchangeRate: 3.67,
  defaultQuoteRates: DEFAULT_APP_QUOTE_RATES,
  timezoneMode: 'auto',
  manualTimezone: '',
  offlineFirst: true,
  radarDefaultMode: 'field',
  radarDefaultRadiusKm: 5,
  radarDefaultFilter: 'all',
  radarBrandStrict: true,
  radarFallbackNearby: true,
  radarAutoHideAfterAction: false,
  radarAutoNextPoint: false,
  gpsHighAccuracy: true,
  gpsUpdateInterval: '10s',
  fieldFocusMode: false,
  soundsEnabled: true,
  hideSchemaWarningUntil: 0,
  publicWhatsappNumber: '971521574546',
  publicTelegramUrl: '',
  publicInstagramUrl: '',
  publicWebsiteUrl: 'https://www.starkmotors.ae',
  publicEmail: 'theahmadking.official@gmail.com',
  publicDeliveryTerms: '',
  publicWorkTerms: '',
  publicCompanyLogoUrl: '',
  publicInvoiceSignatureUrl: '',
  publicManagerName: '',
  invoicePaymentAccountNo: '',
  invoicePaymentBeneficiary: '',
  invoicePaymentBankAccount: '',
  publicTermsFileUrl: '',
  publicTermsFileName: '',
  executorPhotoUrl: '',
  executorRole: '',
  publicContactsUpdatedAt: 0,
  appSettingsUpdatedAt: 0,
  cargoTariffs: DEFAULT_CARGO_TARIFFS,
  weeklyGoalAed: 2000,
  morningNotificationTime: '07:30',
  eveningNotificationTime: '21:00',
  userName: 'Руслан',
  orderZones: ['Zone 2', 'Zone 3', 'Zone 4', 'Zone 6', 'Zone 7', 'Zone 8', 'Ajman', 'Sajah', 'Dubai'],
  aiCoreApiKey: ''
};

const normalizeQuoteRates = (raw: unknown, fallbackUsdToAed?: unknown): AppQuoteRates => {
  const source = raw && typeof raw === 'object' ? raw as Partial<Record<AppQuoteCurrency, unknown>> : {};
  const next: AppQuoteRates = { ...DEFAULT_APP_QUOTE_RATES };
  (Object.keys(DEFAULT_APP_QUOTE_RATES) as AppQuoteCurrency[]).forEach((code) => {
    const parsed = Number(source[code]);
    if (Number.isFinite(parsed) && parsed > 0) next[code] = parsed;
  });
  const usdToAed = Number(fallbackUsdToAed);
  if ((!source.USD || !Number.isFinite(Number(source.USD))) && Number.isFinite(usdToAed) && usdToAed > 0) {
    next.USD = 1 / usdToAed;
  }
  next.AED = 1;
  return next;
};

const normalizeSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  ...(raw || {}),
  defaultExchangeRate: Number.isFinite(Number(raw?.defaultExchangeRate)) ? Number(raw?.defaultExchangeRate) : DEFAULT_APP_SETTINGS.defaultExchangeRate,
  defaultQuoteRates: normalizeQuoteRates(raw?.defaultQuoteRates, raw?.defaultExchangeRate),
  manualTimezone: typeof raw?.manualTimezone === 'string' ? raw.manualTimezone : '',
  publicWhatsappNumber: typeof raw?.publicWhatsappNumber === 'string'
    ? raw.publicWhatsappNumber.replace(/[^\d]/g, '')
    : DEFAULT_APP_SETTINGS.publicWhatsappNumber,
  publicTelegramUrl: typeof raw?.publicTelegramUrl === 'string' ? raw.publicTelegramUrl : '',
  publicInstagramUrl: typeof raw?.publicInstagramUrl === 'string' ? raw.publicInstagramUrl.trim() : '',
  publicWebsiteUrl: typeof raw?.publicWebsiteUrl === 'string' ? raw.publicWebsiteUrl.trim() : DEFAULT_APP_SETTINGS.publicWebsiteUrl,
  publicEmail: typeof raw?.publicEmail === 'string' ? raw.publicEmail.trim() : DEFAULT_APP_SETTINGS.publicEmail,
  publicDeliveryTerms: typeof raw?.publicDeliveryTerms === 'string' ? raw.publicDeliveryTerms : '',
  publicWorkTerms: typeof raw?.publicWorkTerms === 'string' ? raw.publicWorkTerms : '',
  publicCompanyLogoUrl: typeof raw?.publicCompanyLogoUrl === 'string' ? raw.publicCompanyLogoUrl : '',
  publicInvoiceSignatureUrl: typeof raw?.publicInvoiceSignatureUrl === 'string' ? raw.publicInvoiceSignatureUrl : '',
  publicManagerName: typeof raw?.publicManagerName === 'string' ? raw.publicManagerName.trim() : '',
  invoicePaymentAccountNo: typeof raw?.invoicePaymentAccountNo === 'string' ? raw.invoicePaymentAccountNo.trim() : '',
  invoicePaymentBeneficiary: typeof raw?.invoicePaymentBeneficiary === 'string' ? raw.invoicePaymentBeneficiary.trim() : '',
  invoicePaymentBankAccount: typeof raw?.invoicePaymentBankAccount === 'string' ? raw.invoicePaymentBankAccount.trim() : '',
  publicTermsFileUrl: typeof raw?.publicTermsFileUrl === 'string' ? raw.publicTermsFileUrl : '',
  publicTermsFileName: typeof raw?.publicTermsFileName === 'string' ? raw.publicTermsFileName : '',
  executorPhotoUrl: typeof raw?.executorPhotoUrl === 'string' ? raw.executorPhotoUrl : '',
  executorRole: typeof raw?.executorRole === 'string' ? raw.executorRole.trim() : '',
  publicContactsUpdatedAt: Number.isFinite(Number(raw?.publicContactsUpdatedAt)) ? Number(raw?.publicContactsUpdatedAt) : 0,
  appSettingsUpdatedAt: Number.isFinite(Number(raw?.appSettingsUpdatedAt)) ? Number(raw?.appSettingsUpdatedAt) : 0,
  defaultVendorChecklist: Array.isArray(raw?.defaultVendorChecklist)
    ? raw.defaultVendorChecklist
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : DEFAULT_APP_SETTINGS.defaultVendorChecklist,
  cargoTariffs: Array.isArray(raw?.cargoTariffs)
    ? raw.cargoTariffs.filter((item): item is CargoTariff => !!item && typeof item === 'object' && typeof (item as CargoTariff).country === 'string')
    : DEFAULT_APP_SETTINGS.cargoTariffs,
  weeklyGoalAed: Number.isFinite(Number(raw?.weeklyGoalAed)) && Number(raw?.weeklyGoalAed) > 0
    ? Number(raw?.weeklyGoalAed)
    : DEFAULT_APP_SETTINGS.weeklyGoalAed,
  morningNotificationTime: typeof raw?.morningNotificationTime === 'string' && raw.morningNotificationTime
    ? raw.morningNotificationTime
    : DEFAULT_APP_SETTINGS.morningNotificationTime,
  eveningNotificationTime: typeof raw?.eveningNotificationTime === 'string' && raw.eveningNotificationTime
    ? raw.eveningNotificationTime
    : DEFAULT_APP_SETTINGS.eveningNotificationTime,
  userName: typeof raw?.userName === 'string' && raw.userName.trim()
    ? raw.userName.trim()
    : DEFAULT_APP_SETTINGS.userName,
  orderZones: Array.isArray(raw?.orderZones)
    ? (raw.orderZones as unknown[]).filter((z): z is string => typeof z === 'string' && z.trim().length > 0).map((z) => z.trim())
    : DEFAULT_APP_SETTINGS.orderZones,
  aiCoreApiKey: typeof raw?.aiCoreApiKey === 'string' ? raw.aiCoreApiKey.trim() : ''
});

const pickPublicSettings = (raw: Partial<AppSettings> | null | undefined): PublicAppSettings => {
  const normalized = normalizeSettings(raw);
  return {
    publicWhatsappNumber: normalized.publicWhatsappNumber,
    publicTelegramUrl: normalized.publicTelegramUrl,
    publicInstagramUrl: normalized.publicInstagramUrl,
    publicWebsiteUrl: normalized.publicWebsiteUrl,
    publicEmail: normalized.publicEmail,
    publicDeliveryTerms: normalized.publicDeliveryTerms,
    publicWorkTerms: normalized.publicWorkTerms,
    publicCompanyLogoUrl: normalized.publicCompanyLogoUrl,
    publicInvoiceSignatureUrl: normalized.publicInvoiceSignatureUrl,
    publicManagerName: normalized.publicManagerName,
    invoicePaymentAccountNo: normalized.invoicePaymentAccountNo,
    invoicePaymentBeneficiary: normalized.invoicePaymentBeneficiary,
    invoicePaymentBankAccount: normalized.invoicePaymentBankAccount,
    publicTermsFileUrl: normalized.publicTermsFileUrl,
    publicTermsFileName: normalized.publicTermsFileName,
    executorPhotoUrl: normalized.executorPhotoUrl,
    executorRole: normalized.executorRole
  };
};

const loadCloudAppSettings = async (): Promise<(AppSettings & { updatedAt: number }) | null> => {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('app_state')
      .select('data,updated_at')
      .eq('id', CLOUD_APP_SETTINGS_ID)
      .maybeSingle();

    if (error) return null;
    const normalized = normalizeSettings((data?.data || {}) as Partial<AppSettings>);
    const updatedAt = Date.parse(String(data?.updated_at || ''));
    return {
      ...normalized,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
    };
  } catch {
    return null;
  }
};

const loadCloudPublicSettings = async (): Promise<CloudPublicSettings | null> => {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('app_state')
      .select('data,updated_at')
      .eq('id', CLOUD_PUBLIC_SETTINGS_ID)
      .maybeSingle();

    if (error) return null;
    const publicData = pickPublicSettings((data?.data || {}) as Partial<AppSettings>);
    const rawUpdatedAt = data?.updated_at;
    const updatedAt = typeof rawUpdatedAt === 'string' ? Date.parse(rawUpdatedAt) : NaN;
    return {
      ...publicData,
      publicContactsUpdatedAt: Number.isFinite(updatedAt)
        ? updatedAt
        : Number((data?.data as Record<string, unknown> | null)?.publicContactsUpdatedAt || 0)
    };
  } catch {
    return null;
  }
};

const saveCloudPublicSettings = async (settings: AppSettings): Promise<void> => {
  if (!supabase) return;

  try {
    await supabase
      .from('app_state')
      .upsert(
        {
          id: CLOUD_PUBLIC_SETTINGS_ID,
          data: {
            ...pickPublicSettings(settings),
            publicContactsUpdatedAt: settings.publicContactsUpdatedAt
          },
          updated_at: new Date().toISOString()
        },
        { onConflict: 'id' }
      );
  } catch {
    // keep local settings as fallback
  }
};

const saveCloudAppSettings = async (settings: AppSettings): Promise<void> => {
  if (!supabase) return;

  try {
    await supabase
      .from('app_state')
      .upsert(
        {
          id: CLOUD_APP_SETTINGS_ID,
          data: settings,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'id' }
      );
  } catch {
    // keep local settings as fallback
  }
};

export const loadAppSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    return normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
};

export const saveAppSettings = (patch: Partial<AppSettings>): AppSettings => {
  const touchesPublicContacts = ['publicWhatsappNumber', 'publicTelegramUrl', 'publicInstagramUrl', 'publicWebsiteUrl', 'publicEmail', 'publicDeliveryTerms', 'publicWorkTerms', 'publicCompanyLogoUrl', 'publicInvoiceSignatureUrl', 'publicManagerName', 'invoicePaymentAccountNo', 'invoicePaymentBeneficiary', 'invoicePaymentBankAccount', 'publicTermsFileUrl', 'publicTermsFileName', 'executorPhotoUrl', 'executorRole']
    .some((field) => Object.prototype.hasOwnProperty.call(patch, field));
  const next = normalizeSettings({
    ...loadAppSettings(),
    ...patch,
    ...(touchesPublicContacts ? { publicContactsUpdatedAt: Date.now() } : {}),
    appSettingsUpdatedAt: Date.now()
  });
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: next }));
  if (touchesPublicContacts) {
    void publishDomainEvent('SETTINGS_PUBLIC_CHANGED', {
      entityType: 'settings',
      entityId: 'public_settings',
      aggregateId: 'public_settings',
      dedupeKey: `settings-public:${next.publicContactsUpdatedAt}`,
      idempotencyKey: `settings-public:${next.publicContactsUpdatedAt}`,
      replaySafe: true,
      source: 'ui',
      payload: { settings: next, changedKeys: Object.keys(patch) as Array<keyof AppSettings> }
    });
  }
  return next;
};

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());

  useEffect(() => {
    let active = true;

    void (async () => {
      const cloudSettings = await loadCloudAppSettings();
      const cloudPublicSettings = await loadCloudPublicSettings();
      if (!active) return;

      const localSettings = loadAppSettings();
      const localUpdatedAt = Number(localSettings.appSettingsUpdatedAt || localSettings.publicContactsUpdatedAt || 0);

      const mergedFromCloud = cloudSettings && Number(cloudSettings.updatedAt || 0) > localUpdatedAt
        ? normalizeSettings(cloudSettings)
        : localSettings;

      if (!cloudPublicSettings) {
        localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(mergedFromCloud));
        setSettings(mergedFromCloud);
        return;
      }

      const cloudUpdatedAt = Number(cloudPublicSettings.publicContactsUpdatedAt || 0);
      const shouldApplyCloud = cloudUpdatedAt > Number(mergedFromCloud.publicContactsUpdatedAt || 0);

      const merged = normalizeSettings(shouldApplyCloud
        ? { ...mergedFromCloud, ...cloudPublicSettings, publicContactsUpdatedAt: cloudUpdatedAt }
        : mergedFromCloud);
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(merged));
      setSettings(merged);
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const custom = event as CustomEvent<AppSettings>;
      if (custom.detail) setSettings(normalizeSettings(custom.detail));
      else setSettings(loadAppSettings());
    };

    window.addEventListener('app-settings-updated', onUpdate);
    return () => window.removeEventListener('app-settings-updated', onUpdate);
  }, []);

  const updateSettings = (patch: Partial<AppSettings>) => {
    const next = saveAppSettings(patch);
    setSettings(next);
    void saveCloudPublicSettings(next);
    void saveCloudAppSettings(next);
    return next;
  };

  return { settings, updateSettings };
};
