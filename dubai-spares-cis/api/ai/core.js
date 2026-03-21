import { createOpenRouterClient } from './openRouterClient.js';
import { aiFailure, aiSuccess } from './response.js';
import { runAiTask } from './taskRouter.js';
import { validateAiRequest } from './validation.js';

export const createAiCore = ({ resolveApiKey } = {}) => {
  const getProviderClient = async (requestApiKey) => createOpenRouterClient({
    apiKey: requestApiKey || (await resolveApiKey?.()) || process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
  });

  return {
    async execute(requestBody) {
      let validated;
      try {
        validated = validateAiRequest(requestBody);
      } catch (error) {
        const task = typeof requestBody?.task === 'string' ? requestBody.task : 'unknown';
        return aiFailure(task, error);
      }

      try {
        const requestApiKey = typeof requestBody?.apiKey === 'string' ? requestBody.apiKey.trim() : '';
        const result = await runAiTask({ ...validated, providerClient: await getProviderClient(requestApiKey) });
        return aiSuccess(validated.task, result);
      } catch (error) {
        return aiFailure(validated.task, error);
      }
    },
  };
};
