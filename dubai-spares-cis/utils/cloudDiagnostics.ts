import { SUPABASE_URL, SUPABASE_ANON_KEY, isCloudConfigured, cloudFeatureFlags } from '../cloudConfig';

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
      console.error('❌ Таблица client_leads не существует. Выполните миграцию!');
      return false;
    }

    if (tableCheck.status === 403) {
      console.error('❌ RLS политики блокируют доступ. Проверьте миграцию!');
      return false;
    }

    console.log('✅ Таблица client_leads доступна');
    return true;
  } catch (error) {
    console.error('❌ Ошибка проверки миграции:', error);
    return false;
  }
};

export const runCloudDiagnostics = async () => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      VITE_SUPABASE_URL: SUPABASE_URL ? `✅ SET (${safeHostname(SUPABASE_URL)})` : '❌ MISSING',
      VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY ? `✅ SET (${SUPABASE_ANON_KEY.substring(0, 20)}...)` : '❌ MISSING'
    },
    config: {
      isCloudConfigured,
      cloudFeatureFlags
    },
    checks: {
      urlValid: Boolean(SUPABASE_URL && /^https:\/\//i.test(SUPABASE_URL)),
      anonKeyValid: Boolean(SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.length > 30),
      clientFormEnabled: cloudFeatureFlags.clientForm,
      migrationAvailable: await checkSupabaseMigration()
    }
  };

  console.table(diagnostics.checks);
  console.log('[leadCreate] Full diagnostics:', JSON.stringify(diagnostics, null, 2));

  return diagnostics;
};

if (import.meta.env.DEV) {
  void runCloudDiagnostics();
}
