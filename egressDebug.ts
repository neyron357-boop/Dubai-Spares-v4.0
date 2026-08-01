import { logger } from './logging';

type EgressRequestType = 'rest' | 'storage';

type EgressRequestRecord = {
  id: string;
  type: EgressRequestType;
  endpoint: string;
  url: string;
  createdAt: number;
  responseBytes: number;
};

type EgressSnapshot = {
  restRequestsPerMinute: number;
  restRequestsCount: number;
  storageHitsCount: number;
  totalResponseBytes: number;
  topEndpoints: Array<{ endpoint: string; hits: number }>;
};

const MAX_RECORDS = 1200;
const STORAGE_KEY = 'egress-debug:session';

const safeParse = (value: string | null): EgressRequestRecord[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as EgressRequestRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object' && typeof item.createdAt === 'number');
  } catch {
    return [];
  }
};

class EgressDebugStore {
  private records: EgressRequestRecord[] = safeParse(window.localStorage.getItem(STORAGE_KEY));

  private emitUpdate() {
    window.dispatchEvent(new CustomEvent('egress-debug-updated'));
  }

  private persist() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records.slice(-MAX_RECORDS)));
  }

  track(url: string, responseBytes: number) {
    const normalized = url.toLowerCase();
    const type: EgressRequestType | null = normalized.includes('/rest/v1/')
      ? 'rest'
      : (normalized.includes('/storage/v1/') || normalized.includes('/images/'))
        ? 'storage'
        : null;
    if (!type) return;

    const endpoint = (() => {
      try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        return pathname.includes('/rest/v1/')
          ? pathname.slice(pathname.indexOf('/rest/v1/'))
          : pathname.includes('/storage/v1/')
            ? pathname.slice(pathname.indexOf('/storage/v1/'))
            : pathname;
      } catch {
        return url;
      }
    })();

    this.records.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      endpoint,
      url,
      createdAt: Date.now(),
      responseBytes: Number.isFinite(responseBytes) ? Math.max(0, Math.round(responseBytes)) : 0
    });

    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    this.persist();
    this.emitUpdate();
  }

  getSnapshot(): EgressSnapshot {
    const now = Date.now();
    const lastMinute = this.records.filter((record) => now - record.createdAt <= 60_000);
    const rest = this.records.filter((record) => record.type === 'rest');
    const storage = this.records.filter((record) => record.type === 'storage');

    const endpointHits = new Map<string, number>();
    for (const record of this.records) {
      endpointHits.set(record.endpoint, (endpointHits.get(record.endpoint) || 0) + 1);
    }

    return {
      restRequestsPerMinute: lastMinute.filter((record) => record.type === 'rest').length,
      restRequestsCount: rest.length,
      storageHitsCount: storage.length,
      totalResponseBytes: this.records.reduce((sum, record) => sum + record.responseBytes, 0),
      topEndpoints: [...endpointHits.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([endpoint, hits]) => ({ endpoint, hits }))
    };
  }

  copySummaryText() {
    const snapshot = this.getSnapshot();
    return [
      `REST requests per minute: ${snapshot.restRequestsPerMinute}`,
      `REST requests count: ${snapshot.restRequestsCount}`,
      `Storage hits count: ${snapshot.storageHitsCount}`,
      `Total response bytes (content-length): ${snapshot.totalResponseBytes}`,
      'Top endpoints:',
      ...snapshot.topEndpoints.map((item, index) => `${index + 1}. ${item.endpoint} — ${item.hits}`)
    ].join('\n');
  }
}

export const egressDebug = new EgressDebugStore();

export const wrapSupabaseFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  try {
    const resolvedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const contentLength = Number(response.headers.get('content-length') || 0);
    egressDebug.track(resolvedUrl, Number.isFinite(contentLength) ? contentLength : 0);
  } catch (error) {
    void logger.warn('egress-debug', 'Failed to track egress request', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return response;
};
