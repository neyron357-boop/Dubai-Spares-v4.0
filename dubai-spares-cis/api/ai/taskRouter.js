import { extractJsonFromText, safeJsonParse } from './safeJson.js';
import { promptBuilders } from './prompts.js';

const normalizeAnalyzeTextResult = (parsed) => ({
  analysis: parsed?.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : parsed,
});

const normalizeTransformTextResult = (parsed) => ({
  transformed_text: typeof parsed?.transformed_text === 'string'
    ? parsed.transformed_text
    : typeof parsed?.text === 'string'
      ? parsed.text
      : typeof parsed === 'string'
        ? parsed
        : '',
});

const normalizeExtractStructuredDataResult = (parsed) => ({
  extracted: parsed?.extracted && typeof parsed.extracted === 'object' ? parsed.extracted : parsed,
});

const resultNormalizers = {
  analyze_text: normalizeAnalyzeTextResult,
  transform_text: normalizeTransformTextResult,
  extract_structured_data: normalizeExtractStructuredDataResult,
};

export const runAiTask = async ({ task, payload, providerClient }) => {
  const promptBuilder = promptBuilders[task];
  if (!promptBuilder) {
    throw new Error(`No prompt builder configured for task: ${task}`);
  }

  const prompt = promptBuilder(payload);
  const raw = await providerClient.generateJson(prompt);
  const parsed = safeJsonParse(raw) ?? extractJsonFromText(raw);

  if (parsed === null) {
    throw new Error('Provider returned invalid JSON');
  }

  const normalize = resultNormalizers[task];
  return normalize ? normalize(parsed) : parsed;
};
