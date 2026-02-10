import { logger } from './logging';

const getAsObject = (error: unknown): Record<string, unknown> => {
  if (typeof error === 'object' && error) return error as Record<string, unknown>;
  return { raw: String(error) };
};

export const logDatabaseIntegrity = async (scope: string, error: unknown, context?: Record<string, unknown>) => {
  const payload = getAsObject(error);
  const code = typeof payload.code === 'string' ? payload.code : null;
  const message = typeof payload.message === 'string' ? payload.message : 'Database error';

  await logger.error('DATABASE_INTEGRITY', `${scope}: ${message}`, {
    code,
    details: payload,
    context
  });

  if (code === 'PGRST204' || code === '42703') {
    await logger.warn('DATABASE_INTEGRITY', 'Schema mismatch detected (missing column or projection)', {
      scope,
      code,
      message,
      context
    });
  }
};
