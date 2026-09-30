import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/security', testMatch: /.*\.auth\.spec\.ts/,
  timeout: 30_000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5175', ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175', timeout: 30_000, reuseExistingServer: false,
    env: { VITE_REQUIRE_AUTH: 'true', VITE_SUPABASE_URL: 'https://qa-only.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_qa_test_not_a_real_key' },
  },
});
