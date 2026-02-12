import { supabase } from './supabase';
import { logger } from './logging';

export const FRONTEND_SCHEMA_VERSION = '2026.02.23';

export type SchemaHealth = {
  frontendVersion: string;
  backendVersion: string | null;
  compatible: boolean;
  reason?: string;
};

const getErrorCode = (error: unknown) => (typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code || '') : '');

export const checkSchemaHealth = async (): Promise<SchemaHealth> => {
  if (!supabase) {
    return { frontendVersion: FRONTEND_SCHEMA_VERSION, backendVersion: null, compatible: true };
  }

  const probe = await supabase.from('shops').select('id,specialization_tag').limit(1);
  if (probe.error) {
    const code = getErrorCode(probe.error);
    const isMissing = code === '42703' || code === 'PGRST204';
    if (isMissing) {
      const status: SchemaHealth = {
        frontendVersion: FRONTEND_SCHEMA_VERSION,
        backendVersion: null,
        compatible: false,
        reason: 'Ошибка схемы базы: нет колонки specialization_tag. Нужно: миграция или обновление фронта.'
      };
      await logger.error('schema:handshake', 'Schema mismatch detected', { code, message: probe.error.message });
      return status;
    }

    await logger.warn('schema:handshake', 'Schema probe warning', { code, message: probe.error.message });
    return { frontendVersion: FRONTEND_SCHEMA_VERSION, backendVersion: null, compatible: true, reason: probe.error.message };
  }

  // app_config is optional; schema compatibility is validated through concrete table probes above.
  return { frontendVersion: FRONTEND_SCHEMA_VERSION, backendVersion: null, compatible: true };
};
