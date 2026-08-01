const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export const normalizeExternalMediaUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!HTTP_PROTOCOLS.has(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
};

export const isLikelyGoogleDriveUrl = (value: unknown): boolean => {
  const normalized = normalizeExternalMediaUrl(value);
  if (!normalized) return false;
  try {
    const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'drive.google.com' || host === 'docs.google.com';
  } catch {
    return false;
  }
};

export const openExternalMediaUrl = (value: unknown): boolean => {
  const url = normalizeExternalMediaUrl(value);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
};
