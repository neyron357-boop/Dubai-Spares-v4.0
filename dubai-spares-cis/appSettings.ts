import { useEffect, useState } from 'react';

export const APP_SETTINGS_KEY = 'dubai_spares_app_settings_v1';

export type AppLanguage = 'ru' | 'en';
export type WhatsAppTemplateLanguage = 'ru' | 'en' | 'ar';
export type CurrencyFormat = 'AED' | 'USD';
export type TimezoneMode = 'auto' | 'manual';
export type RadarDefaultMode = 'field' | 'detail';
export type RadarDefaultFilter = 'all' | 'new_only' | 'used_only' | 'open_now';
export type GpsUpdateInterval = '10s' | '30s' | 'manual';

export interface AppSettings {
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
  hideSchemaWarningUntil: number;
  publicWhatsappNumber: string;
  publicTelegramUrl: string;
  publicInstagramUrl: string;
  publicDeliveryTerms: string;
  publicWorkTerms: string;
  publicContactsUpdatedAt: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
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
  hideSchemaWarningUntil: 0,
  publicWhatsappNumber: '971000000000',
  publicTelegramUrl: '',
  publicInstagramUrl: '',
  publicDeliveryTerms: '',
  publicWorkTerms: '',
  publicContactsUpdatedAt: 0
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
  publicContactsUpdatedAt: Number.isFinite(Number(raw?.publicContactsUpdatedAt)) ? Number(raw?.publicContactsUpdatedAt) : 0
});

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
  const touchesPublicContacts = ['publicWhatsappNumber', 'publicTelegramUrl', 'publicInstagramUrl', 'publicDeliveryTerms', 'publicWorkTerms']
    .some((field) => Object.prototype.hasOwnProperty.call(patch, field));
  const next = normalizeSettings({
    ...loadAppSettings(),
    ...patch,
    ...(touchesPublicContacts ? { publicContactsUpdatedAt: Date.now() } : {})
  });
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: next }));
  return next;
};

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());

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
    return next;
  };

  return { settings, updateSettings };
};
