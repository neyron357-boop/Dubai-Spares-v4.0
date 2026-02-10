import { Coordinates } from './types';
import { logger } from './logging';

const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();
const GOOGLE_HOST = 'https://maps.googleapis.com/maps/api';

const MAPS_URL_HOSTS = new Set([
  'maps.google.com',
  'www.google.com',
  'google.com',
  'maps.app.goo.gl',
  'www.maps.app.goo.gl'
]);

const PLACE_ID_REGEXES = [
  /[?&]query_place_id=([^&]+)/i,
  /[?&]place_id=([^&]+)/i,
  /!1s(ChI[\w-]+)/,
  /\/place\/(?:[^/]+\/)?(ChI[\w-]+)/
];

const extractCoordinates = (value: string): Coordinates | undefined => {
  const match = value.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (!match) return undefined;
  return { lat: Number(match[1]), lng: Number(match[2]) };
};

const normalizePlaceId = (value: string) => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

const isGoogleMapsUrl = (raw: string): boolean => {
  if (!raw || !raw.startsWith('http')) return false;
  try {
    const url = new URL(raw);
    return MAPS_URL_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.toLowerCase().endsWith('.google.com');
  } catch {
    return false;
  }
};

const extractPlaceIdFromLink = (raw: string): string | null => {
  for (const regex of PLACE_ID_REGEXES) {
    const match = raw.match(regex);
    if (match?.[1]) {
      return normalizePlaceId(match[1]);
    }
  }
  return null;
};

const fetchJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Maps API request failed: ${response.status}`);
  }
  return response.json();
};

const findPlaceIdByInput = async (input: string): Promise<string | null> => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `${GOOGLE_HOST}/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data?.candidates) || data.candidates.length === 0) return null;
  const placeId = data.candidates[0]?.place_id;
  return typeof placeId === 'string' && placeId ? placeId : null;
};

const fetchPlaceCoordinates = async (placeId: string): Promise<Coordinates | null> => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `${GOOGLE_HOST}/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry/location&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const data = await fetchJson(url);
  const location = data?.result?.geometry?.location;
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const geocodeAddress = async (address: string): Promise<Coordinates | null> => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `${GOOGLE_HOST}/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const data = await fetchJson(url);
  const location = data?.results?.[0]?.geometry?.location;
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

export const resolveCoordinatesFromLocation = async (location: string): Promise<Coordinates | undefined> => {
  const raw = (location || '').trim();
  if (!raw) return undefined;

  const direct = extractCoordinates(raw);
  if (direct) return direct;

  try {
    if (isGoogleMapsUrl(raw)) {
      const parsedPlaceId = extractPlaceIdFromLink(raw);
      const placeId = parsedPlaceId || await findPlaceIdByInput(raw);
      if (placeId) {
        const fromPlace = await fetchPlaceCoordinates(placeId);
        if (fromPlace) return fromPlace;
      }
    }

    const geocoded = await geocodeAddress(raw);
    return geocoded || undefined;
  } catch (error) {
    void logger.warn('maps:resolve', 'Unable to resolve coordinates from location input', {
      location: raw,
      error: error instanceof Error ? error.message : String(error),
      hasGoogleMapsApiKey: Boolean(GOOGLE_MAPS_API_KEY)
    });
    return undefined;
  }
};

export const hasGoogleMapsApiKey = Boolean(GOOGLE_MAPS_API_KEY);
