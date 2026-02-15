import { logger } from './logging';

interface Coordinates { lat: number; lng: number }

const extractCoordinates = (value: string): Coordinates | null => {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

export const resolveCoordinatesFromLocation = async (
  rawLocation: string,
  _options?: { fallbackQueries?: string[] }
): Promise<Coordinates | undefined> => {
  const normalized = (rawLocation || '').trim();
  if (!normalized) return undefined;
  const parsed = extractCoordinates(normalized);
  if (!parsed) {
    await logger.info('maps:resolve', 'Local mode: unresolved location string', { rawLocation: normalized });
    return undefined;
  }
  return parsed;
};

export const hasGoogleMapsApiKey = false;
