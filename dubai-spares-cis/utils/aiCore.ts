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

const AI_CORE_URL = `${import.meta.env.VITE_SERVER_API_URL || 'http://localhost:8080'}/ai/tasks`;

const postAiTask = async <TTask extends AiTask, TResult>(task: TTask, payload: unknown): Promise<AiResponse<TTask, TResult>> => {
  try {
    const response = await fetch(AI_CORE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task, payload }),
    });

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return { ok: false, task, result: null, error: 'Invalid AI gateway response' };
    }

    return data as AiResponse<TTask, TResult>;
  } catch (error) {
    return {
      ok: false,
      task,
      result: null,
      error: error instanceof Error ? error.message : 'AI gateway request failed',
    };
  }
};

export const aiCore = {
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
