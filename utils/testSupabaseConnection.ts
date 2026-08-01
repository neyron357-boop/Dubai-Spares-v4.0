import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../cloudConfig';

export const testSupabaseConnection = async () => {
  console.log('[TEST] Testing Supabase connection...');

  const testPayload = {
    name: 'Test Lead',
    phone: '+971501234567',
    message: 'Test message from diagnostics',
    payload: { test: true, timestamp: Date.now() }
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/client_leads`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(testPayload)
    });

    const data = await response.json();

    console.log('[TEST] Response status:', response.status);
    console.log('[TEST] Response data:', data);

    if (response.ok) {
      console.log('✅ [TEST] Supabase connection works!');
      return { success: true, data };
    }

    console.error('❌ [TEST] Supabase error:', data);
    return { success: false, error: data };
  } catch (error) {
    console.error('❌ [TEST] Network error:', error);
    return { success: false, error };
  }
};

if (typeof window !== 'undefined') {
  (window as Window & { testSupabaseConnection?: typeof testSupabaseConnection }).testSupabaseConnection = testSupabaseConnection;
}
