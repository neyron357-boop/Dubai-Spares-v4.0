import { SUPABASE_URL, SUPABASE_ANON_KEY, isCloudConfigured, cloudFeatureFlags, getCloudConfigDiagnostics } from '../cloudConfig';

const safeHostname = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return 'invalid-url';
  }
};

export const checkSupabaseMigration = async () => {
  try {
    const tableCheck = await fetch(`${SUPABASE_URL}/rest/v1/client_leads?limit=0`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (tableCheck.status === 404) {
      console.warn('Таблица client_leads не найдена. Проверьте миграцию Supabase.');
      return false;
    }

    if (tableCheck.status === 403) {
      console.warn('RLS политики блокируют доступ к client_leads. Проверьте миграцию Supabase.');
      return false;
    }

    console.info('Таблица client_leads доступна');
    return true;
  } catch (error) {
    console.warn('Ошибка проверки миграции:', error);
    return false;
  }
};

export const runCloudDiagnostics = async () => {
  const configDiagnostics = getCloudConfigDiagnostics();
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      VITE_SUPABASE_URL: configDiagnostics.rawSupabaseUrlState === 'present' ? `✅ SET (${safeHostname(SUPABASE_URL)})` : '❌ MISSING',
      VITE_SUPABASE_ANON_KEY: configDiagnostics.rawSupabaseAnonKeyState === 'present' ? `✅ SET (${configDiagnostics.rawSupabaseAnonKey})` : '❌ MISSING'
    },
    config: {
      isCloudConfigured,
      cloudFeatureFlags,
      configDiagnostics
    },
    checks: {
      urlValid: configDiagnostics.isSupabaseUrlValid,
      anonKeyJwt: configDiagnostics.isSupabaseAnonKeyJwt,
      anonKeyPublishable: configDiagnostics.isSupabaseAnonKeyPublishable,
      anonKeyAccepted: configDiagnostics.isSupabaseAnonKeyJwt || configDiagnostics.isSupabaseAnonKeyPublishable,
      clientFormEnabled: cloudFeatureFlags.clientForm,
      migrationAvailable: await checkSupabaseMigration()
    }
  };

  console.table(diagnostics.checks);
  console.log('[leadCreate] Full diagnostics:', JSON.stringify(diagnostics, null, 2));

  return diagnostics;
};
