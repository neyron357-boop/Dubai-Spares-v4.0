import { useEffect, useState } from 'react';
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

export interface AppSettings {
  defaultVendorChecklist: string[];
  appLanguage: AppLanguage;
  waTemplateLanguage: WhatsAppTemplateLanguage;
  currencyFormat: CurrencyFormat;
  defaultExchangeRate: number;
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
  publicDeliveryTerms: string;
  publicWorkTerms: string;
  publicCompanyLogoUrl: string;
  publicInvoiceSignatureUrl: string;
  publicManagerName: string;
  publicTermsFileUrl: string;
  publicTermsFileName: string;
  publicContactsUpdatedAt: number;
  appSettingsUpdatedAt: number;
  cargoTariffs: CargoTariff[];
}

type PublicAppSettings = Pick<AppSettings, 'publicWhatsappNumber' | 'publicTelegramUrl' | 'publicInstagramUrl' | 'publicDeliveryTerms' | 'publicWorkTerms' | 'publicCompanyLogoUrl' | 'publicInvoiceSignatureUrl' | 'publicManagerName' | 'publicTermsFileUrl' | 'publicTermsFileName'>;
type CloudPublicSettings = PublicAppSettings & Pick<AppSettings, 'publicContactsUpdatedAt'>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultVendorChecklist: [],
  appLanguage: 'ru',
  waTemplateLanguage: 'ru',
  currencyFormat: 'AED',
  defaultExchangeRate: 3.67,
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
  publicWhatsappNumber: '971000000000',
  publicTelegramUrl: '',
  publicInstagramUrl: '',
  publicDeliveryTerms: '',
  publicWorkTerms: '',
  publicCompanyLogoUrl: '',
  publicInvoiceSignatureUrl: '',
  publicManagerName: '',
  publicTermsFileUrl: '',
  publicTermsFileName: '',
  publicContactsUpdatedAt: 0,
  appSettingsUpdatedAt: 0,
  cargoTariffs: DEFAULT_CARGO_TARIFFS
};

const normalizeSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  ...(raw || {}),
  defaultExchangeRate: Number.isFinite(Number(raw?.defaultExchangeRate)) ? Number(raw?.defaultExchangeRate) : DEFAULT_APP_SETTINGS.defaultExchangeRate,
  manualTimezone: typeof raw?.manualTimezone === 'string' ? raw.manualTimezone : '',
  publicWhatsappNumber: typeof raw?.publicWhatsappNumber === 'string'
    ? raw.publicWhatsappNumber.replace(/[^\d]/g, '')
    : DEFAULT_APP_SETTINGS.publicWhatsappNumber,
  publicTelegramUrl: typeof raw?.publicTelegramUrl === 'string' ? raw.publicTelegramUrl : '',
  publicInstagramUrl: typeof raw?.publicInstagramUrl === 'string' ? raw.publicInstagramUrl : '',
  publicDeliveryTerms: typeof raw?.publicDeliveryTerms === 'string' ? raw.publicDeliveryTerms : '',
  publicWorkTerms: typeof raw?.publicWorkTerms === 'string' ? raw.publicWorkTerms : '',
  publicCompanyLogoUrl: typeof raw?.publicCompanyLogoUrl === 'string' ? raw.publicCompanyLogoUrl : '',
  publicInvoiceSignatureUrl: typeof raw?.publicInvoiceSignatureUrl === 'string' ? raw.publicInvoiceSignatureUrl : '',
  publicManagerName: typeof raw?.publicManagerName === 'string' ? raw.publicManagerName.trim() : '',
  publicTermsFileUrl: typeof raw?.publicTermsFileUrl === 'string' ? raw.publicTermsFileUrl : '',
  publicTermsFileName: typeof raw?.publicTermsFileName === 'string' ? raw.publicTermsFileName : '',
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
    : DEFAULT_APP_SETTINGS.cargoTariffs
});

const pickPublicSettings = (raw: Partial<AppSettings> | null | undefined): PublicAppSettings => {
  const normalized = normalizeSettings(raw);
  return {
    publicWhatsappNumber: normalized.publicWhatsappNumber,
    publicTelegramUrl: normalized.publicTelegramUrl,
    publicInstagramUrl: normalized.publicInstagramUrl,
    publicDeliveryTerms: normalized.publicDeliveryTerms,
    publicWorkTerms: normalized.publicWorkTerms,
    publicCompanyLogoUrl: normalized.publicCompanyLogoUrl,
    publicInvoiceSignatureUrl: normalized.publicInvoiceSignatureUrl,
    publicManagerName: normalized.publicManagerName,
    publicTermsFileUrl: normalized.publicTermsFileUrl,
    publicTermsFileName: normalized.publicTermsFileName
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
  const touchesPublicContacts = ['publicWhatsappNumber', 'publicTelegramUrl', 'publicInstagramUrl', 'publicDeliveryTerms', 'publicWorkTerms', 'publicCompanyLogoUrl', 'publicInvoiceSignatureUrl', 'publicManagerName', 'publicTermsFileUrl', 'publicTermsFileName']
    .some((field) => Object.prototype.hasOwnProperty.call(patch, field));
  const next = normalizeSettings({
    ...loadAppSettings(),
    ...patch,
    ...(touchesPublicContacts ? { publicContactsUpdatedAt: Date.now() } : {}),
    appSettingsUpdatedAt: Date.now()
  });
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: next }));
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
