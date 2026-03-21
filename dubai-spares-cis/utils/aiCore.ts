import { SUPABASE_ANON_KEY } from '../cloudConfig';

export type AiTask = 'analyze_text' | 'transform_text' | 'extract_structured_data';

export type AiSuccess<TTask extends AiTask, TResult> = {
  ok: true;
  task: TTask;
  result: TResult;
  error: null;
};

export type AiFailure<TTask extends string = string> = {
  ok: false;
  task: TTask;
  result: null;
  error: string;
};

export type AiResponse<TTask extends AiTask, TResult> = AiSuccess<TTask, TResult> | AiFailure<TTask>;

export type AnalyzeTextPayload = {
  text: string;
  instructions: string;
};

export type TransformTextPayload = {
  text: string;
  operation: string;
  target_lang?: string;
  tone?: string;
  format?: string;
  instructions?: string;
};

export type ExtractStructuredDataPayload = {
  text: string;
  schema: Record<string, unknown>;
  instructions?: string;
};

export type AnalyzeTextResult = { analysis: Record<string, unknown> };
export type TransformTextResult = { transformed_text: string };
export type ExtractStructuredDataResult = { extracted: Record<string, unknown> };

export const AI_CORE_URL = 'https://nbnfaxsvdlcdycnuzieu.supabase.co/functions/v1/super-service';
const isSupabaseJwt = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(SUPABASE_ANON_KEY);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeAiResponse = <TTask extends AiTask, TResult>(task: TTask, data: unknown, fallbackError: string): AiResponse<TTask, TResult> => {
  if (!isRecord(data)) {
    return { ok: false, task, result: null, error: fallbackError };
  }

  if (data.ok === true) {
    return {
      ok: true,
      task: data.task === task ? task : task,
      result: (data.result ?? {}) as TResult,
      error: null,
    };
  }

  const error = typeof data.error === 'string' && data.error.trim()
    ? data.error.trim()
    : fallbackError;

  return {
    ok: false,
    task,
    result: null,
    error,
  };
};

const postAiTask = async <TTask extends AiTask, TResult>(task: TTask, payload: unknown): Promise<AiResponse<TTask, TResult>> => {
  if (!isSupabaseJwt) {
    return {
      ok: false,
      task,
      result: null,
      error: 'AI core is disabled: VITE_SUPABASE_ANON_KEY must be the Supabase anon JWT key that starts with "eyJ". Keys starting with "sb_publishable_" return 401 for this endpoint.'
    };
  }

  try {
    const response = await fetch(AI_CORE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ task, payload }),
    });

    const data = await response.json().catch(() => null);
    const fallbackError = response.ok
      ? 'Invalid AI core response'
      : `AI core request failed (${response.status})`;

    const normalized = normalizeAiResponse<TTask, TResult>(task, data, fallbackError);

    if (!response.ok && normalized.ok) {
      return {
        ok: false,
        task,
        result: null,
        error: fallbackError,
      };
    }

    return normalized;
  } catch (error) {
    return {
      ok: false,
      task,
      result: null,
      error: error instanceof Error ? error.message : 'AI core request failed',
    };
  }
};

export const aiCore = {
  url: AI_CORE_URL,
  analyzeText(payload: AnalyzeTextPayload) {
    return postAiTask<'analyze_text', AnalyzeTextResult>('analyze_text', payload);
  },
  transformText(payload: TransformTextPayload) {
    return postAiTask<'transform_text', TransformTextResult>('transform_text', payload);
  },
  extractStructuredData(payload: ExtractStructuredDataPayload) {
    return postAiTask<'extract_structured_data', ExtractStructuredDataResult>('extract_structured_data', payload);
  },
};
