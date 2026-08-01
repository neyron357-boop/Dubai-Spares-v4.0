# Changelog

## Unreleased

### Fixed
- Added detailed lead creation logging (`[leadCreate]`) across guard checks, payload build, request dispatch, and response handling.
- Hardened Supabase REST call flow with request/response logging and retry for transient network/timeout errors.
- Improved cloud guard feedback with explicit configuration failure reason (`cloud_disabled`).
- Added Supabase status utilities:
  - `runCloudDiagnostics()`
  - `checkSupabaseMigration()`
  - `testSupabaseConnection()` exposed as `window.testSupabaseConnection()`.
- Added DEV cloud status badge on public order form.
- Added local lead retry queue for automatic resend when network is restored.
- Added manual **Test Connection** action in Settings.
- Added `tests/leadCreation.test.ts` covering config, feature flag, happy path, and network failure path.
