import { AI_REQUEST_TIMEOUT_MS, DEFAULT_OPENROUTER_MODEL } from './constants.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const withTimeout = async (requestPromise, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await requestPromise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

export const createOpenRouterClient = ({ apiKey, model }) => {
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  return {
    async generateJson({ system, user }) {
      return withTimeout(async (signal) => {
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model || DEFAULT_OPENROUTER_MODEL,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`OpenRouter request failed: ${response.status}${text ? ` ${text}` : ''}`);
        }

        const data = await response.json();
        return data?.choices?.[0]?.message?.content || '';
      }, AI_REQUEST_TIMEOUT_MS);
    },
  };
};
