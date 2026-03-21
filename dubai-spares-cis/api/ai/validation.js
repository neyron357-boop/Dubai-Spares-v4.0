import { SUPPORTED_AI_TASKS } from './constants.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const ensureObject = (value, label) => {
  if (!isObject(value)) {
    throw new Error(`${label} must be an object`);
  }
};

const validateAnalyzeText = (payload) => {
  ensureObject(payload, 'payload');
  if (!isNonEmptyString(payload.text)) throw new Error('payload.text is required');
  if (!isNonEmptyString(payload.instructions)) throw new Error('payload.instructions is required');
};

const validateTransformText = (payload) => {
  ensureObject(payload, 'payload');
  if (!isNonEmptyString(payload.text)) throw new Error('payload.text is required');
  if (!isNonEmptyString(payload.operation)) throw new Error('payload.operation is required');
};

const validateExtractStructuredData = (payload) => {
  ensureObject(payload, 'payload');
  if (!isNonEmptyString(payload.text)) throw new Error('payload.text is required');
  ensureObject(payload.schema, 'payload.schema');
};

export const validateAiRequest = (input) => {
  ensureObject(input, 'request body');
  const { task, payload } = input;
  if (!isNonEmptyString(task)) throw new Error('task is required');
  if (!SUPPORTED_AI_TASKS.includes(task)) {
    throw new Error(`Unsupported task: ${task}`);
  }

  if (task === 'analyze_text') validateAnalyzeText(payload);
  if (task === 'transform_text') validateTransformText(payload);
  if (task === 'extract_structured_data') validateExtractStructuredData(payload);

  return {
    task,
    payload,
  };
};
