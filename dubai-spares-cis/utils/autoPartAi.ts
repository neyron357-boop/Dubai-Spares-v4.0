const AUTO_PART_AI_URL = 'https://nbnfaxsvdlcdycnuzieu.supabase.co/functions/v1/auto-part-ai';

export type AutoPartAiAnalysis = {
  category: string;
  translated: string;
  translatedRu: string;
  estimatedWeightKg: number | null;
  fragile: boolean | null;
  sizeClass: string;
};

const EMPTY_ANALYSIS: AutoPartAiAnalysis = {
  category: '',
  translated: '',
  translatedRu: '',
  estimatedWeightKg: null,
  fragile: null,
  sizeClass: '',
};

const resultCache = new Map<string, AutoPartAiAnalysis>();
const inFlight = new Map<string, Promise<AutoPartAiAnalysis>>();

const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ');

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const readString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const readNumber = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const readBoolean = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', '1'].includes(normalized)) return true;
      if (['false', 'no', '0'].includes(normalized)) return false;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
  }
  return null;
};

const parseAnalysis = (payload: unknown): AutoPartAiAnalysis => {
  const data = asRecord(payload);
  return {
    category: readString(data.category, data.part_type, data.partType),
    translated: readString(data.translated, data.translation, data.translated_en),
    translatedRu: readString(data.translated_ru, data.translatedRu, data.translation_ru),
    estimatedWeightKg: readNumber(data.estimated_weight_kg, data.estimatedWeightKg, data.weight_kg, data.weightKg),
    fragile: readBoolean(data.fragile, data.is_fragile, data.isFragile),
    sizeClass: readString(data.size_class, data.sizeClass),
  };
};

export const analyzeAutoPartText = async (text: string): Promise<AutoPartAiAnalysis> => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return EMPTY_ANALYSIS;

  const cacheKey = normalizedText.toLowerCase();
  const cached = resultCache.get(cacheKey);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const request = fetch(AUTO_PART_AI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: normalizedText }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`AI helper request failed: ${response.status}`);
      const payload = await response.json();
      const parsed = parseAnalysis(payload);
      resultCache.set(cacheKey, parsed);
      return parsed;
    })
    .catch((error) => {
      console.error('auto-part-ai:error', error);
      return EMPTY_ANALYSIS;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, request);
  return request;
};

export const resolveAutoPartTranslation = (
  analysis: AutoPartAiAnalysis | null | undefined,
  originalText: string,
  language: 'ru' | 'en' | 'ar'
) => {
  if (!analysis) return originalText;
  if (language === 'ru') return analysis.translatedRu || originalText;
  if (language === 'en') return analysis.translated || originalText;
  return analysis.translated || analysis.translatedRu || originalText;
};

export const inferCargoPlacesFromAnalysis = (analysis: AutoPartAiAnalysis | null | undefined) => {
  if (!analysis?.sizeClass) return 1;
  const normalized = analysis.sizeClass.toLowerCase();
  if (normalized.includes('oversize') || normalized.includes('large') || normalized.includes('xl')) return 2;
  return 1;
};

export const isOversizedFromAnalysis = (analysis: AutoPartAiAnalysis | null | undefined) => {
  const normalized = String(analysis?.sizeClass || '').toLowerCase();
  return normalized.includes('oversize') || normalized.includes('large') || normalized.includes('xl');
};
