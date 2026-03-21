import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../cloudConfig';
import { wrapSupabaseFetch } from '../egressDebug';

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

export type AiRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  cancelPrevious?: boolean;
};

const AI_FUNCTION_NAME = 'super-service';
const DEFAULT_TIMEOUT_MS = 15_000;
const TIMEOUT_ERROR_MESSAGE = 'AI request timed out. Please try again.';
const CANCELLED_ERROR_MESSAGE = 'AI request was cancelled. Please retry.';

export const AI_CORE_URL = `${SUPABASE_URL}/functions/v1/${AI_FUNCTION_NAME}`;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

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

const readResponseBody = async (response: Response): Promise<unknown> => {
  try {
    const text = await response.text();
    return text ? parseJsonSafely(text) ?? text : null;
  } catch {
    return null;
  }
};

let activeRequestController: AbortController | null = null;

const cancelActiveRequest = (reason = CANCELLED_ERROR_MESSAGE) => {
  if (!activeRequestController || activeRequestController.signal.aborted) return;
  activeRequestController.abort(reason);
};

const postAiTask = async <TTask extends AiTask, TResult>(task: TTask, payload: unknown, options: AiRequestOptions = {}): Promise<AiResponse<TTask, TResult>> => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return toStructuredFailure(task, 'AI core is disabled: Supabase client is not configured.');
  }

  const requestController = new AbortController();
  const timeoutMs = Math.max(12_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 20_000));
  let timeoutTriggered = false;

  if (options.cancelPrevious !== false) {
    cancelActiveRequest();
    activeRequestController = requestController;
  }

  const abortFromSignal = () => {
    if (!requestController.signal.aborted) {
      requestController.abort(options.signal?.reason ?? CANCELLED_ERROR_MESSAGE);
    }
  };

  options.signal?.addEventListener('abort', abortFromSignal, { once: true });

  const timeoutId = window.setTimeout(() => {
    timeoutTriggered = true;
    if (!requestController.signal.aborted) {
      requestController.abort(TIMEOUT_ERROR_MESSAGE);
    }
  }, timeoutMs);

  try {
    const response = await wrapSupabaseFetch(AI_CORE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ task, payload }),
      signal: requestController.signal,
    });

    const data = await readResponseBody(response);

    if (!response.ok) {
      return normalizeAiResponse<TTask, TResult>(task, data, 'Edge Function returned a non-2xx status code');
    }

    return normalizeAiResponse<TTask, TResult>(task, data, 'Invalid AI core response');
  } catch (error) {
    if (timeoutTriggered) {
      return toStructuredFailure(task, TIMEOUT_ERROR_MESSAGE);
    }

    if (requestController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      const reason = typeof requestController.signal.reason === 'string' && requestController.signal.reason.trim()
        ? requestController.signal.reason.trim()
        : CANCELLED_ERROR_MESSAGE;
      return toStructuredFailure(task, reason);
    }

    const fallbackMessage = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Edge Function returned a non-2xx status code';
    return toStructuredFailure(task, fallbackMessage);
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromSignal);
    if (activeRequestController === requestController) {
      activeRequestController = null;
    }
  }
};

export const aiCore = {
  functionName: AI_FUNCTION_NAME,
  url: AI_CORE_URL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  cancelActiveRequest,
  analyzeText(payload: AnalyzeTextPayload, options?: AiRequestOptions) {
    return postAiTask<'analyze_text', AnalyzeTextResult>('analyze_text', payload, options);
  },
  transformText(payload: TransformTextPayload, options?: AiRequestOptions) {
    return postAiTask<'transform_text', TransformTextResult>('transform_text', payload, options);
  },
  extractStructuredData(payload: ExtractStructuredDataPayload, options?: AiRequestOptions) {
    return postAiTask<'extract_structured_data', ExtractStructuredDataResult>('extract_structured_data', payload, options);
  },
};
