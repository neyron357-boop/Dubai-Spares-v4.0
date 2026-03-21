import { SUPABASE_URL } from '../cloudConfig';
import { supabase } from '../supabaseClient';

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

const AI_FUNCTION_NAME = 'super-service';
export const AI_CORE_URL = `${SUPABASE_URL}/functions/v1/${AI_FUNCTION_NAME}`;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const readErrorMessage = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return '';
};

const normalizeAiResponse = <TTask extends AiTask, TResult>(task: TTask, data: unknown, fallbackError: string): AiResponse<TTask, TResult> => {
  if (!isRecord(data)) {
    return { ok: false, task, result: null, error: fallbackError };
  }

  const normalizedTask = typeof data.task === 'string' && data.task.trim() ? data.task.trim() : task;

  if (data.ok === true) {
    return {
      ok: true,
      task: normalizedTask as TTask,
      result: (data.result ?? {}) as TResult,
      error: null,
    };
  }

  const error = typeof data.error === 'string' && data.error.trim()
    ? data.error.trim()
    : fallbackError;

  return {
    ok: false,
    task: normalizedTask,
    result: null,
    error,
  };
};

const toStructuredFailure = <TTask extends AiTask>(task: TTask, error: string): AiFailure<TTask> => ({
  ok: false,
  task,
  result: null,
  error,
});

const parseJsonSafely = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractBodyPayload = async (responseLike: unknown): Promise<unknown> => {
  if (!responseLike) return null;

  if (typeof Response !== 'undefined' && responseLike instanceof Response) {
    try {
      const cloned = responseLike.clone();
      const text = await cloned.text();
      return text ? parseJsonSafely(text) ?? text : null;
    } catch {
      return null;
    }
  }

  if (isRecord(responseLike)) {
    const candidateText = readErrorMessage(responseLike.body);
    if (candidateText) return parseJsonSafely(candidateText) ?? candidateText;

    const jsonFn = responseLike.json;
    if (typeof jsonFn === 'function') {
      try {
        return await jsonFn.call(responseLike);
      } catch {
        // Ignore and continue with text fallback.
      }
    }

    const textFn = responseLike.text;
    if (typeof textFn === 'function') {
      try {
        const text = await textFn.call(responseLike);
        return typeof text === 'string' && text ? parseJsonSafely(text) ?? text : null;
      } catch {
        return null;
      }
    }
  }

  return null;
};

const extractErrorPayload = async (error: unknown): Promise<unknown> => {
  if (!isRecord(error)) return null;

  const sources = [
    error.context,
    error.response,
    error.data,
    error.body,
  ];

  for (const source of sources) {
    if (!source) continue;
    const parsed = await extractBodyPayload(source);
    if (parsed != null) return parsed;
    if (isRecord(source) && ('ok' in source || 'error' in source || 'task' in source || 'result' in source)) {
      return source;
    }
  }

  return null;
};

const extractInvokeErrorMessage = async <TTask extends AiTask>(task: TTask, error: unknown, fallbackMessage: string): Promise<AiFailure<TTask>> => {
  const payload = await extractErrorPayload(error);
  const normalized = normalizeAiResponse<TTask, never>(task, payload, fallbackMessage);
  if (!normalized.ok) {
    return normalized;
  }

  const directMessage = readErrorMessage(error);
  return toStructuredFailure(task, directMessage || fallbackMessage);
};

const postAiTask = async <TTask extends AiTask, TResult>(task: TTask, payload: unknown): Promise<AiResponse<TTask, TResult>> => {
  if (!supabase) {
    return toStructuredFailure(task, 'AI core is disabled: Supabase client is not configured.');
  }

  try {
    const { data, error } = await supabase.functions.invoke(AI_FUNCTION_NAME, {
      body: { task, payload },
    });

    if (error) {
      return await extractInvokeErrorMessage(task, error, 'Edge Function returned a non-2xx status code');
    }

    return normalizeAiResponse<TTask, TResult>(task, data, 'Invalid AI core response');
  } catch (error) {
    return await extractInvokeErrorMessage(task, error, 'Edge Function returned a non-2xx status code');
  }
};

export const aiCore = {
  functionName: AI_FUNCTION_NAME,
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
