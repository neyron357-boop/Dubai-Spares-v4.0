import { Source } from './types';
import { CAR_BODY_TYPES, CAR_DATABASE } from './carDatabase';

export const BRANDS = Object.keys(CAR_DATABASE).sort();

export const SOURCES = Object.values(Source);

export const SOCIAL_SOURCES: Source[] = [
  Source.INSTAGRAM,
  Source.FACEBOOK,
  Source.TELEGRAM,
  Source.WHATSAPP,
  Source.TIKTOK
];

export const BRAND_MODELS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CAR_DATABASE).map(([brand, catalog]) => [brand, catalog.models])
);

export const BRAND_BODY_TYPES: Record<string, string[]> = Object.fromEntries(
  Object.entries(CAR_DATABASE).map(([brand, catalog]) => [brand, catalog.bodyTypes])
);

export const BODY_TYPES = CAR_BODY_TYPES;
export const YEARS = Array.from({ length: 45 }, (_, i) => (new Date().getFullYear() - i).toString());

export const DEFAULT_MARKUP = 15;
export const DEFAULT_RATE = 3.67;
