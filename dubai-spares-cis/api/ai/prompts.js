const jsonOnly = 'Return valid JSON only. Do not include markdown, comments, or explanations.';

export const buildAnalyzeTextPrompt = (payload) => ({
  system: [
    'You are an internal AI task worker for an automotive parts application.',
    'Help with semantic interpretation only.',
    'Do not invent deterministic business rules or pricing logic.',
    jsonOnly,
  ].join(' '),
  user: JSON.stringify({
    task: 'analyze_text',
    instructions: payload.instructions,
    text: payload.text,
    expected_result_shape: {
      analysis: 'object',
    },
  }),
});

export const buildTransformTextPrompt = (payload) => ({
  system: [
    'You are an internal AI text transformation worker.',
    'Perform the requested transformation and keep the answer concise.',
    jsonOnly,
  ].join(' '),
  user: JSON.stringify({
    task: 'transform_text',
    operation: payload.operation,
    text: payload.text,
    target_lang: payload.target_lang || null,
    tone: payload.tone || null,
    format: payload.format || null,
    instructions: payload.instructions || null,
    expected_result_shape: {
      transformed_text: 'string',
    },
  }),
});

export const buildExtractStructuredDataPrompt = (payload) => ({
  system: [
    'You are an internal AI extraction worker.',
    'Extract structured JSON that matches the requested schema as closely as possible.',
    'If a field cannot be inferred, return null for that field.',
    jsonOnly,
  ].join(' '),
  user: JSON.stringify({
    task: 'extract_structured_data',
    text: payload.text,
    schema: payload.schema,
    instructions: payload.instructions || null,
    expected_result_shape: {
      extracted: payload.schema,
    },
  }),
});

export const promptBuilders = {
  analyze_text: buildAnalyzeTextPrompt,
  transform_text: buildTransformTextPrompt,
  extract_structured_data: buildExtractStructuredDataPrompt,
};
