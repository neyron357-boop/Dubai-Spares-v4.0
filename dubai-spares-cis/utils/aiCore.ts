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

const normalizeAiResponse = <TTask extends AiTask, TResult>(task: TTask, data: unknown, fallbackError: string): AiResponse<TTask, TResult> => {
  if (!isRecord(data)) {
    return { ok: false, task, result: null, error: fallbackError };
  }

  if (data.ok === true) {
    return {
      ok: true,
      task,
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

const toStructuredFailure = <TTask extends AiTask>(task: TTask, error: string): AiFailure<TTask> => ({
  ok: false,
  task,
  result: null,
  error,
});

const postAiTask = async <TTask extends AiTask, TResult>(task: TTask, payload: unknown): Promise<AiResponse<TTask, TResult>> => {
  if (!supabase) {
    return toStructuredFailure(task, 'AI core is disabled: Supabase client is not configured.');
  }

  try {
    const { data, error } = await supabase.functions.invoke(AI_FUNCTION_NAME, {
      body: { task, payload },
    });

    if (error) {
      return toStructuredFailure(task, error.message || 'AI core request failed');
    }

    return normalizeAiResponse<TTask, TResult>(task, data, 'Invalid AI core response');
  } catch (error) {
    return toStructuredFailure(task, error instanceof Error ? error.message : 'AI core request failed');
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
