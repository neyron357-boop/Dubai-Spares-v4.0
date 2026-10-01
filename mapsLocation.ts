import { Coordinates } from './types';

/** Parse coordinates already present in pasted map links, without contacting a maps API. */
export const resolveCoordinatesFromLocation = async (
  location: string,
  options: { fallbackQueries?: string[]; onManualLocationRequired?: (...args: any[]) => void } = {},
): Promise<Coordinates | undefined> => {
  let value = String(location || '').trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* Pasted text may contain a literal percent sign. */
  }
  for (const pattern of [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /(?:q|query|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/,
  ]) {
    const match = value.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]),
      lng = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  if (value) options.onManualLocationRequired?.();
  return undefined;
};
