/**
 * Returns true when the Supabase/PostgREST error indicates the table or view
 * does not exist in the schema cache (HTTP 404, PGRST205, etc.).
 * Used to silently skip optional tables (app_state, shops, …) instead of
 * surfacing noise in the console.
 */
export const isTableMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = String(anyErr.code || '').toUpperCase();
  const status = Number(anyErr.status);
  const message = String(anyErr.message || '').toLowerCase();
  return (
    status === 404 ||
    code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes('not found in the schema cache')
  );
};
