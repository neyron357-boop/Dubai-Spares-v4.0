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

const isGoogleUserContentUrl = (raw: string): boolean => {
  if (!raw || !raw.startsWith('http')) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'googleusercontent.com' || host === 'www.googleusercontent.com' || host.endsWith('.googleusercontent.com');
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

const REDIRECT_QUERY_KEYS = ['url', 'u', 'q', 'target', 'redirect', 'dest', 'destination'];

const hasMapsCoordinatesOrPlace = (value: string) => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes('google.com/maps/place')
    || normalized.includes('/maps/place/')
    || normalized.includes('/maps/search/')
    || normalized.includes('/maps/dir/')
    || Boolean(extractCoordinates(value))
  );
};

const hasAtCoordinates = (value: string) => /@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i.test(value);

const isRedirectProxyUrl = (raw: string): boolean => {
  if (!raw || !raw.startsWith('http')) return false;
  return isGoogleShortMapsUrl(raw) || isGoogleUserContentUrl(raw);
};

const decodeUrlCandidate = (value: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const tryValues = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded && decoded !== trimmed) tryValues.push(decoded);
  } catch {
    // noop
  }

  for (const candidate of tryValues) {
    if (/^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
};

const getUrlFromRedirectQuery = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    for (const key of REDIRECT_QUERY_KEYS) {
      const candidate = decodeUrlCandidate(url.searchParams.get(key) || '');
      if (candidate) return candidate;
    }
  } catch {
    return null;
  }
  return null;
};

const expandGoogleRedirectUrl = async (raw: string): Promise<string | null> => {
  if (!isGoogleMapsUrl(raw)) return null;

  const queryExpandedFirst = getUrlFromRedirectQuery(raw);
  if (queryExpandedFirst && queryExpandedFirst !== raw) {
    return queryExpandedFirst;
  }

  try {
    const manual = await fetch(raw, { method: 'GET', redirect: 'manual' });
    const location = manual.headers.get('location');
    if (location) {
      const next = new URL(location, raw).toString();
      if (next !== raw) return next;
    }
  } catch {
    // noop, continue to follow-based fallbacks
  }

  try {
    const response = await fetch(raw, { method: 'HEAD', redirect: 'follow' });
    if (response?.url && response.url !== raw) {
      return response.url;
    }
  } catch {
    // noop, continue to fallbacks below
  }

  try {
    // Browser fallback: opaque response can still expose final URL after redirects.
    const response = await fetch(raw, { method: 'GET', redirect: 'follow', mode: 'no-cors' });
    return response?.url && response.url !== raw ? response.url : null;
  } catch {
    return null;
  }
};

const getLocationHeaderRedirect = async (raw: string): Promise<string | null> => {
  try {
    const manual = await fetch(raw, { method: 'GET', redirect: 'manual' });
    const location = manual.headers.get('location');
    if (!location) return null;
    return new URL(location, raw).toString();
  } catch {
    return null;
  }
};

interface ResolveCoordinatesOptions {
  fallbackQueries?: string[];
}

const expandLocationUrlChain = async (raw: string, maxHops = 8): Promise<string> => {
  let current = raw;
  let hops = 0;

  while (hops < maxHops) {
    const shouldContinue = !hasAtCoordinates(current)
      && (isGoogleUserContentUrl(current) || isGoogleShortMapsUrl(current) || isRedirectProxyUrl(current));
    if (!shouldContinue) break;

    const next = await getLocationHeaderRedirect(current) || await expandGoogleRedirectUrl(current);
    if (!next || next === current) break;

    current = next;
    hops += 1;

    if (!current.includes('googleusercontent.com') && !isGoogleShortMapsUrl(current) && hasMapsCoordinatesOrPlace(current)) {
      break;
    }
  }

  return current;
};

const dedupe = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const cleanFallbackQuery = (value: string): string => {
  const withoutLinks = value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/\b(?:maps\.app\.goo\.gl|goo\.gl|googleusercontent\.com|google\.com\/maps)\S*/gi, ' ');

  return withoutLinks
    .replace(/[\\/_|#?&=%:+~*.,;()[\]{}<>"'`!-]+/g, ' ')
    .replace(/\b[a-z0-9]{8,}\b/gi, ' ')
    .replace(/\b(?:http|https|www|maps|app|goo|gl|google|com|googleusercontent|g|st|ic)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildCanonicalShopName = (values: string[]) => {
  const tokens = dedupe(values)
    .map((value) => cleanFallbackQuery(value))
    .flatMap((value) => value.split(/\s+/).map((token) => token.trim()).filter(Boolean))
    .filter((token) => !['dubai', 'sharjah'].includes(token.toLowerCase()));

  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.some((x) => x.toLowerCase() === token.toLowerCase())) unique.push(token);
  }

  return unique.slice(0, 3).join(' ').trim();
};

const buildSanitizedFallbackQueries = (values: string[]) => {
  const merged = dedupe(values.map((value) => cleanFallbackQuery(value)).filter(Boolean));
  const mergedText = merged.join(' ');
  const hasDubai = /\bdubai\b/i.test(mergedText);
  const hasSharjah = /\bsharjah\b/i.test(mergedText);
  const canonicalShopName = buildCanonicalShopName(values);

  if (!canonicalShopName) return [];
  if (hasDubai) return [`${canonicalShopName} Dubai`];
  if (hasSharjah) return [`${canonicalShopName} Sharjah`];
  return [`${canonicalShopName} Dubai`, `${canonicalShopName} Sharjah`];
};

const buildDubaiSharjahFallbackQueries = (values: string[]) => {
  return dedupe(buildSanitizedFallbackQueries(values));
};

const geocodeFallbackQueries = async (queries: string[]): Promise<Coordinates | null> => {
  for (const query of buildDubaiSharjahFallbackQueries(queries)) {
    const geocoded = await geocodeAddress(query);
    if (geocoded) {
      await logger.info('RADAR_GEO', 'Fallback shop geocoding result: Success', {
        query,
        coordinates: [geocoded.lat, geocoded.lng]
      });
      return geocoded;
    }
  }
  return null;
};

export const resolveCoordinatesFromLocation = async (
  location: string,
  options: ResolveCoordinatesOptions = {}
): Promise<Coordinates | undefined> => {
  const { fallbackQueries = [] } = options;
  const raw = (location || '').trim();
  if (!raw && fallbackQueries.length === 0) return undefined;
  const normalizedRaw = normalizeMapsInput(raw);

  await logger.debug('RADAR_GEO', 'Manual location input received', { rawLocation: raw, fallbackQueries });

  if (normalizedRaw) {
    try {
      if (isGoogleMapsUrl(normalizedRaw)) {
        const redirectTarget = await expandLocationUrlChain(normalizedRaw);
        if (redirectTarget !== normalizedRaw) {
          await logger.info('RADAR_GEO', 'Google redirect URL expanded', { rawLocation: normalizedRaw, redirectTarget });
        }

        const fromExpandedCoordinates = extractCoordinates(redirectTarget);
        if (fromExpandedCoordinates) {
          await logger.info('RADAR_GEO', 'Google redirect URL parsed', { coordinates: [fromExpandedCoordinates.lat, fromExpandedCoordinates.lng] });
          return fromExpandedCoordinates;
        }

        const fromDirectGoogleCoordinates = extractCoordinates(normalizedRaw);
        if (fromDirectGoogleCoordinates) {
          await logger.info('RADAR_GEO', 'Manual location parsing result: Success', { coordinates: [fromDirectGoogleCoordinates.lat, fromDirectGoogleCoordinates.lng] });
          return fromDirectGoogleCoordinates;
        }

        const fromUrlGeocode = isGoogleShortMapsUrl(normalizedRaw) ? null : await geocodeByUrl(redirectTarget);
        if (fromUrlGeocode) {
          await logger.info('RADAR_GEO', 'Google URL geocoding result: Success', { coordinates: [fromUrlGeocode.lat, fromUrlGeocode.lng] });
          return fromUrlGeocode;
        }
        const parsedPlaceId = extractPlaceIdFromLink(redirectTarget);
        const placeId = parsedPlaceId || await findPlaceIdByInput(redirectTarget);
        if (placeId) {
          const fromPlace = await fetchPlaceCoordinates(placeId);
          if (fromPlace) {
            await logger.info('RADAR_GEO', 'Google place coordinates resolved', { placeId, coordinates: [fromPlace.lat, fromPlace.lng] });
            return fromPlace;
          }
        }
      } else {
        const direct = extractCoordinates(normalizedRaw);
        if (direct) {
          await logger.info('RADAR_GEO', 'Manual location parsing result: Success', { coordinates: [direct.lat, direct.lng] });
          return direct;
        }
      }

      await logger.warn('RADAR_GEO', 'Manual location parsing result: Fail', { reason: 'Regex mismatch', rawLocation: raw, expandedLocation: isGoogleMapsUrl(normalizedRaw) ? await expandLocationUrlChain(normalizedRaw) : normalizedRaw });

      const geocoded = await geocodeAddress(normalizedRaw);
      if (geocoded) {
        await logger.info('RADAR_GEO', 'Address geocoding result: Success', { coordinates: [geocoded.lat, geocoded.lng] });
        return geocoded;
      }
      await logger.warn('RADAR_GEO', 'Address geocoding result: Fail', { reason: 'No results', rawLocation: raw });
    } catch (error) {
      void logger.warn('maps:resolve', 'Unable to resolve coordinates from location input', {
        location: raw,
        error: error instanceof Error ? error.message : String(error),
        hasGoogleMapsApiKey: Boolean(GOOGLE_MAPS_API_KEY)
      });
    }
  }

  const fallbackGeocoded = await geocodeFallbackQueries(fallbackQueries);
  if (fallbackGeocoded) {
    return fallbackGeocoded;
  }

  if (fallbackQueries.length > 0) {
    await logger.warn('RADAR_GEO', 'Fallback shop geocoding result: Fail', {
      reason: 'No results',
      fallbackQueries: buildDubaiSharjahFallbackQueries(fallbackQueries)
    });
  }

  return undefined;
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


export const hasGoogleMapsApiKey = Boolean(GOOGLE_MAPS_API_KEY);
