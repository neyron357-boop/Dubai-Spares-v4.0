import { Coordinates } from './types';
import { logger } from './logging';

const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();
const GOOGLE_HOST = 'https://maps.googleapis.com/maps/api';

const MAPS_URL_HOSTS = new Set([
  'maps.google.com',
  'www.google.com',
  'google.com',
  'maps.app.goo.gl',
  'www.maps.app.goo.gl',
  'goo.gl',
  'www.goo.gl',
  'googleusercontent.com',
  'www.googleusercontent.com',
  'lh3.googleusercontent.com'
]);

const PLACE_ID_REGEXES = [
  /[?&]query_place_id=([^&]+)/i,
  /[?&]place_id=([^&]+)/i,
  /!1s(ChI[\w-]+)/,
  /\/place\/(?:[^/]+\/)?(ChI[\w-]+)/
];

const LAT_LNG_REGEXES = [
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
  /\/dir\/(?:[^/]*\/)*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/
];

const extractCoordinates = (value: string): Coordinates | undefined => {
  for (const regex of LAT_LNG_REGEXES) {
    const match = value.match(regex);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  return undefined;
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
    const host = url.hostname.toLowerCase();
    return (
      MAPS_URL_HOSTS.has(host)
      || host.endsWith('.google.com')
      || host.endsWith('.googleusercontent.com')
      || host.endsWith('.goo.gl')
    );
  } catch {
    return false;
  }
};

const isGoogleShortMapsUrl = (raw: string): boolean => {
  if (!raw || !raw.startsWith('http')) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'www.maps.app.goo.gl' || host === 'goo.gl' || host === 'www.goo.gl';
  } catch {
    return false;
  }
};

const normalizeMapsInput = (raw: string): string => {
  try {
    const url = new URL(raw);
    ['g_st', 'g_ep', 'gws_rd', 'pli'].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return raw;
  }
};

const expandShortGoogleMapsUrl = async (raw: string): Promise<string | null> => {
  if (!isGoogleShortMapsUrl(raw)) return null;
  try {
    // Use no-cors to allow following redirects in the browser and then parse the final URL.
    const response = await fetch(raw, { method: 'GET', redirect: 'follow', mode: 'no-cors' });
    return response?.url && response.url !== raw ? response.url : null;
  } catch {
    return null;
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


const geocodeByUrl = async (urlValue: string): Promise<Coordinates | null> => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `${GOOGLE_HOST}/geocode/json?address=${encodeURIComponent(urlValue)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
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
  const normalizedRaw = normalizeMapsInput(raw);

  await logger.debug('RADAR_GEO', 'Manual location input received', { rawLocation: raw });

  const direct = extractCoordinates(normalizedRaw);
  if (direct) {
    await logger.info('RADAR_GEO', 'Manual location parsing result: Success', { coordinates: [direct.lat, direct.lng] });
    return direct;
  }

  await logger.warn('RADAR_GEO', 'Manual location parsing result: Fail', { reason: 'Regex mismatch', rawLocation: raw });

  try {
    if (isGoogleMapsUrl(normalizedRaw)) {
      const expandedUrl = await expandShortGoogleMapsUrl(normalizedRaw);
      if (expandedUrl) {
        const fromExpandedCoordinates = extractCoordinates(expandedUrl);
        if (fromExpandedCoordinates) {
          await logger.info('RADAR_GEO', 'Google short URL expanded and parsed', { coordinates: [fromExpandedCoordinates.lat, fromExpandedCoordinates.lng] });
          return fromExpandedCoordinates;
        }
      }

      const fromUrlGeocode = isGoogleShortMapsUrl(normalizedRaw) ? null : await geocodeByUrl(normalizedRaw);
      if (fromUrlGeocode) {
        await logger.info('RADAR_GEO', 'Google URL geocoding result: Success', { coordinates: [fromUrlGeocode.lat, fromUrlGeocode.lng] });
        return fromUrlGeocode;
      }
      const parsedPlaceId = extractPlaceIdFromLink(expandedUrl || normalizedRaw);
      const placeId = parsedPlaceId || await findPlaceIdByInput(expandedUrl || normalizedRaw);
      if (placeId) {
        const fromPlace = await fetchPlaceCoordinates(placeId);
        if (fromPlace) {
          await logger.info('RADAR_GEO', 'Google place coordinates resolved', { placeId, coordinates: [fromPlace.lat, fromPlace.lng] });
          return fromPlace;
        }
      }
    }

    const geocoded = await geocodeAddress(normalizedRaw);
    if (geocoded) {
      await logger.info('RADAR_GEO', 'Address geocoding result: Success', { coordinates: [geocoded.lat, geocoded.lng] });
      return geocoded;
    }
    await logger.warn('RADAR_GEO', 'Address geocoding result: Fail', { reason: 'No results', rawLocation: raw });
    return undefined;
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
