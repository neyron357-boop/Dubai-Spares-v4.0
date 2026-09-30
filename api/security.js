import { timingSafeEqual } from 'node:crypto';

const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com', 'web.push.apple.com'];
export const isAllowedPushEndpoint = (endpoint) => {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
      && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
};

export const hasValidSecret = (provided, expected) => {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};
