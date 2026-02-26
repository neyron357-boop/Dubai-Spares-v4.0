const BROKEN_IMAGE_BLACKLIST_KEY = 'broken_image_blacklist_v1';
const BROKEN_IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeImageUrl = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.includes('/storage/v1/object/public/')) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('quality');
      parsed.searchParams.delete('format');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
};

type BrokenMap = Record<string, number>;

const readBrokenMap = (): BrokenMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BROKEN_IMAGE_BLACKLIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BrokenMap;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeBrokenMap = (map: BrokenMap) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BROKEN_IMAGE_BLACKLIST_KEY, JSON.stringify(map));
  } catch {
    // noop
  }
};

export const clearExpiredBrokenImageUrls = (): void => {
  const now = Date.now();
  const map = readBrokenMap();
  const cleaned = Object.fromEntries(Object.entries(map).filter(([, expiresAt]) => Number(expiresAt) > now));
  writeBrokenMap(cleaned);
};

export const markBrokenImageUrl = (url: string, ttlMs = BROKEN_IMAGE_TTL_MS): void => {
  const normalized = normalizeImageUrl(url);
  if (!normalized) return;
  const map = readBrokenMap();
  map[normalized] = Date.now() + ttlMs;
  writeBrokenMap(map);
};

export const isBrokenImageUrl = (url: string): boolean => {
  const normalized = normalizeImageUrl(url);
  if (!normalized) return false;
  const map = readBrokenMap();
  const expiresAt = Number(map[normalized] || 0);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    delete map[normalized];
    writeBrokenMap(map);
    return false;
  }
  return true;
};

export const removeBrokenImageUrl = (url: string): void => {
  const normalized = normalizeImageUrl(url);
  if (!normalized) return;
  const map = readBrokenMap();
  if (!map[normalized]) return;
  delete map[normalized];
  writeBrokenMap(map);
};

export const clearBrokenImageBlacklist = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(BROKEN_IMAGE_BLACKLIST_KEY);
};

export const shouldBlacklistByStatus = (status: number): boolean => status === 400 || status === 403 || status === 404;

export const getBrokenImagePlaceholder = (): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#e2e8f0"/><g fill="#64748b"><rect x="182" y="130" width="276" height="220" rx="18"/><circle cx="258" cy="210" r="32" fill="#e2e8f0"/><path d="M212 308l60-62 54 52 40-36 62 46z" fill="#e2e8f0"/></g><text x="320" y="386" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#475569">Фото недоступно</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const normalizeBrokenImageKey = normalizeImageUrl;
