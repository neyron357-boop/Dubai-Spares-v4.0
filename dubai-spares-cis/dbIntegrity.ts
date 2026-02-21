import { logger } from './logging';

const getAsObject = (error: unknown): Record<string, unknown> => {
  if (typeof error === 'object' && error) return error as Record<string, unknown>;
  return { raw: String(error) };
};

const DB_CODE_PREFIXES = ['PGRST', '42', '22', '23', '08'];

const isDatabaseIntegrityError = (payload: Record<string, unknown>) => {
  const code = typeof payload.code === 'string' ? payload.code.toUpperCase() : '';
  if (code && DB_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return true;

  const status = Number(payload.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return true;

  const message = typeof payload.message === 'string' ? payload.message.toLowerCase() : '';
  const details = typeof payload.details === 'string' ? payload.details.toLowerCase() : '';
  const probe = `${message} ${details}`;

  return probe.includes('column')
    || probe.includes('relation')
    || probe.includes('schema')
    || probe.includes('postgres')
    || probe.includes('supabase');
};

export const logDatabaseIntegrity = async (scope: string, error: unknown, context?: Record<string, unknown>) => {
  const payload = getAsObject(error);
  if (!isDatabaseIntegrityError(payload)) return;

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
